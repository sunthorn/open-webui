// Pure logic behind the Briefing page. No Svelte, no fetch — so vitest can
// hold it to account. Rendering lives in src/lib/components/agenda/*.
import type { AgendaEvent, AgendaResponse, AgendaSource, AgendaTask, ClientVia } from '$lib/apis/gateway/agenda';
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

// --- writes: what the planner is about to change, and what the page shows
// while the gateway does it. The page confirms with describeChange(), applies
// applyChange() optimistically, POSTs, then re-fetches (spec §10 write flow).

export type AgendaChange =
	| { kind: 'complete'; task: AgendaTask }
	| { kind: 'snooze'; task: AgendaTask; until: string }
	| { kind: 'move'; event: AgendaEvent; startAt: string; endAt: string }
	| { kind: 'pin'; item: AgendaTask | AgendaEvent; clientId: string; clientName: string }
	| { kind: 'reject'; task: AgendaTask; clientId: string; clientName: string }
	| { kind: 'unpin'; item: AgendaTask | AgendaEvent };

const addDays = (day: string, n: number): string => {
	const [y, m, d] = day.split('-').map(Number);
	return isoDate(new Date(y, m - 1, d + n));
};

export const snoozeUntil = (today: string, choice: 'tomorrow' | 'nextWeek'): string =>
	addDays(today, choice === 'tomorrow' ? 1 : 7);

const dayLabel = (day: string): string =>
	new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

const timeLabel = (iso: string): string =>
	new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const describeChange = (c: AgendaChange): string => {
	switch (c.kind) {
		case 'complete':
			return `Mark "${c.task.title}" as done in ${SOURCE_META[c.task.source].label}?`;
		case 'snooze':
			return `Move "${c.task.title}" to ${dayLabel(c.until)} (${c.until}) in ${SOURCE_META[c.task.source].label}?`;
		case 'move':
			return `Move "${c.event.title}" to ${timeLabel(c.startAt)} – ${new Date(c.endAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} in ${SOURCE_META[c.event.source].label}?`;
		case 'pin':
			return `Assign "${c.item.title}" to ${c.clientName}?`;
		case 'reject':
			return `Not ${c.clientName}? "${c.task.title}" won't be suggested for them again.`;
		case 'unpin':
			return `Clear the client on "${c.item.title}"? The rules will re-match it on refresh.`;
	}
};

const mapTask = (a: AgendaResponse, id: string, f: (t: AgendaTask) => AgendaTask | null): AgendaResponse => ({
	...a,
	tasks: a.tasks.flatMap((t) => {
		if (t.id !== id) return [t];
		const next = f(t);
		return next ? [next] : [];
	})
});
const mapEvent = (a: AgendaResponse, id: string, f: (e: AgendaEvent) => AgendaEvent): AgendaResponse => ({
	...a,
	events: a.events.map((e) => (e.id === id ? f(e) : e))
});
const isTask = (i: AgendaTask | AgendaEvent): i is AgendaTask => 'status' in i;

export const applyChange = (a: AgendaResponse, c: AgendaChange): AgendaResponse => {
	switch (c.kind) {
		case 'complete':
			return mapTask(a, c.task.id, () => null);
		case 'snooze':
			return mapTask(a, c.task.id, (t) => ({ ...t, dueAt: c.until, status: 'open' }));
		case 'move':
			return mapEvent(a, c.event.id, (e) => ({ ...e, startAt: c.startAt, endAt: c.endAt }));
		case 'pin': {
			const client = { id: c.clientId, name: c.clientName, via: 'pin' as const };
			return isTask(c.item)
				? mapTask(a, c.item.id, (t) => { const { suggestion: _s, ...rest } = t; return { ...rest, client }; })
				: mapEvent(a, c.item.id, (e) => ({ ...e, client }));
		}
		case 'reject':
			return mapTask(a, c.task.id, (t) => { const { suggestion: _s, ...rest } = t; return rest; });
		case 'unpin':
			return isTask(c.item)
				? mapTask(a, c.item.id, (t) => { const { client: _c, ...rest } = t; return rest; })
				: mapEvent(a, c.item.id, (e) => { const { client: _c, ...rest } = e; return rest; });
	}
};

/** ISO (any offset) → the local 'YYYY-MM-DDTHH:mm' a datetime-local input wants. */
export const toLocalInput = (iso: string): string => {
	const d = new Date(iso);
	const p = (n: number) => String(n).padStart(2, '0');
	return `${isoDate(d)}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Two datetime-local values → ISO with an explicit offset (the gateway refuses naive times). */
export const moveWindow = (startLocal: string, endLocal: string): { startAt: string; endAt: string } | { error: string } => {
	if (!startLocal || !endLocal) return { error: 'Pick a start and an end time' };
	const s = new Date(startLocal), e = new Date(endLocal);
	if (isNaN(s.getTime()) || isNaN(e.getTime())) return { error: 'Pick a start and an end time' };
	if (e <= s) return { error: 'End must be after start' };
	const iso = (d: Date) => d.toISOString().replace('Z', '+00:00');
	return { startAt: iso(s), endAt: iso(e) };
};

export const clientLabel = (via: ClientVia): string =>
	via === 'pin' ? 'pinned by you' : via === 'agent' ? 'suggested by the agent' : 'matched by rule';
