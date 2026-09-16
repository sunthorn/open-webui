// Pure logic behind the Briefing page. No Svelte, no fetch — so vitest can
// hold it to account. Rendering lives in src/lib/components/agenda/*.
import type { AgendaEvent, AgendaSource, AgendaTask } from '$lib/apis/gateway/agenda';
import { isoDate } from '$lib/apis/gateway/agenda';
import type { CalendarEventModel, CalendarModel } from '$lib/apis/calendar';

export const SOURCE_META: Record<AgendaSource, { label: string; color: string; openLabel: string }> = {
	xplan: { label: 'XPLAN', color: '#7c3aed', openLabel: 'Open in XPLAN' },
	m365: { label: 'Outlook', color: '#0f6cbd', openLabel: 'Open in Outlook' },
	google: { label: 'Google', color: '#188038', openLabel: 'Open in Google' }
};

const NS = 1_000_000;
const DEFAULT_START = 7;
const DEFAULT_END = 19;
const MIN_HEIGHT_PCT = 3;

/** A bare date ('2026-09-14') is a calendar day; anything longer is a timestamp in the local zone. */
export const localDay = (iso: string): string => (iso.length <= 10 ? iso : isoDate(new Date(iso)));

const byDue = (a: AgendaTask, b: AgendaTask): number => {
	if (!a.dueAt && !b.dueAt) return a.title.localeCompare(b.title);
	if (!a.dueAt) return 1;
	if (!b.dueAt) return -1;
	return a.dueAt.localeCompare(b.dueAt) || a.title.localeCompare(b.title);
};

export interface TaskGroup {
	key: string;
	label: string;
	kind: 'overdue' | 'client' | 'unassigned';
	tasks: AgendaTask[];
}

export const groupTasks = (tasks: AgendaTask[], _today: string): TaskGroup[] => {
	const overdue = tasks.filter((t) => t.status === 'overdue').sort(byDue);
	const rest = tasks.filter((t) => t.status !== 'overdue');
	const clients = new Map<string, TaskGroup>();
	const unassigned: AgendaTask[] = [];
	for (const t of rest) {
		if (!t.client) {
			unassigned.push(t);
			continue;
		}
		const g = clients.get(t.client.id) ?? { key: t.client.id, label: t.client.name, kind: 'client' as const, tasks: [] };
		g.tasks.push(t);
		clients.set(t.client.id, g);
	}
	const out: TaskGroup[] = [];
	if (overdue.length) out.push({ key: 'overdue', label: 'Overdue', kind: 'overdue', tasks: overdue });
	out.push(
		...[...clients.values()]
			.sort((a, b) => a.label.localeCompare(b.label))
			.map((g) => ({ ...g, tasks: g.tasks.sort(byDue) }))
	);
	if (unassigned.length) out.push({ key: 'unassigned', label: 'Unassigned', kind: 'unassigned', tasks: unassigned.sort(byDue) });
	return out;
};

const hourOf = (iso: string): number => {
	const d = new Date(iso);
	return d.getHours() + d.getMinutes() / 60;
};

export const eventsOn = (events: AgendaEvent[], day: string): AgendaEvent[] =>
	events.filter((e) => !e.allDay && localDay(e.startAt) === day).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));

export const allDayOn = (events: AgendaEvent[], day: string): AgendaEvent[] =>
	events.filter((e) => e.allDay && localDay(e.startAt) <= day && day <= localDay(e.endAt || e.startAt));

export const timelineRange = (events: AgendaEvent[], day: string): { startHour: number; endHour: number } => {
	let start = DEFAULT_START;
	let end = DEFAULT_END;
	for (const e of eventsOn(events, day)) {
		start = Math.min(start, Math.floor(hourOf(e.startAt)));
		end = Math.max(end, Math.ceil(hourOf(e.endAt || e.startAt)));
	}
	return { startHour: Math.max(0, start), endHour: Math.min(24, Math.max(end, start + 1)) };
};

export const placeEvent = (
	e: AgendaEvent,
	range: { startHour: number; endHour: number },
	day: string
): { top: number; height: number } | null => {
	if (e.allDay || localDay(e.startAt) !== day) return null;
	const span = range.endHour - range.startHour;
	const s = Math.max(hourOf(e.startAt), range.startHour);
	const en = Math.min(hourOf(e.endAt || e.startAt), range.endHour);
	const top = ((s - range.startHour) / span) * 100;
	const height = Math.max(MIN_HEIGHT_PCT, ((en - s) / span) * 100);
	return { top, height };
};

const midnightNs = (day: string, plusDays = 0): number => {
	const [y, m, d] = day.split('-').map(Number);
	return new Date(y, m - 1, d + plusDays).getTime() * NS;
};

export const toCalendarEvents = (events: AgendaEvent[]): CalendarEventModel[] =>
	events.map((e) => ({
		id: e.id,
		calendar_id: e.source,
		user_id: '',
		title: e.title,
		description: null,
		start_at: e.allDay ? midnightNs(localDay(e.startAt)) : Date.parse(e.startAt) * NS,
		end_at: e.allDay ? midnightNs(localDay(e.endAt || e.startAt), 1) - 1 : Date.parse(e.endAt || e.startAt) * NS,
		all_day: e.allDay,
		rrule: null,
		color: SOURCE_META[e.source].color,
		location: e.location ?? null,
		data: { href: e.href, client: e.client ?? null },
		meta: null,
		is_cancelled: false,
		attendees: [],
		created_at: 0,
		updated_at: 0
	}));

export const sourceCalendars = (): CalendarModel[] =>
	(Object.keys(SOURCE_META) as AgendaSource[]).map((s) => ({
		id: s,
		user_id: '',
		name: SOURCE_META[s].label,
		color: SOURCE_META[s].color,
		is_default: false,
		is_system: false,
		data: null,
		meta: null,
		access_grants: [],
		created_at: 0,
		updated_at: 0
	}));

export const fallbackAttention = (tasks: AgendaTask[], today: string): AgendaTask[] => {
	const overdue = tasks.filter((t) => t.status === 'overdue').sort(byDue);
	const dueToday = tasks.filter((t) => t.status !== 'overdue' && t.dueAt?.slice(0, 10) === today).sort(byDue);
	return [...overdue, ...dueToday].slice(0, 6);
};
