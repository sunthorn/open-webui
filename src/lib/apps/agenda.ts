// Pure logic behind the Briefing page. No Svelte, no fetch — so vitest can
// hold it to account. Rendering lives in src/lib/components/agenda/*.
import type {
	AgendaEvent, AgendaResponse, AgendaSource, AgendaSourceStatus, AgendaTask, ClientVia, ConnectorProvider, ConnectorsResponse
} from '$lib/apis/gateway/agenda';
import { isoDate } from '$lib/apis/gateway/agenda';
import type { CalendarEventModel, CalendarModel } from '$lib/apis/calendar';

export const SOURCE_META: Record<AgendaSource, { label: string; color: string; openLabel: string }> = {
	xplan: { label: 'XPLAN', color: '#7c3aed', openLabel: 'Open in XPLAN' },
	m365: { label: 'Outlook', color: '#0f6cbd', openLabel: 'Open in Outlook' },
	google: { label: 'Google', color: '#188038', openLabel: 'Open in Google' }
};

const NS = 1_000_000;
const DEFAULT_START = 7;

/** A bare date ('2026-09-14') is a calendar day; anything longer is a timestamp in the local zone. */
export const localDay = (iso: string): string => (iso.length <= 10 ? iso : isoDate(new Date(iso)));

const byDue = (a: AgendaTask, b: AgendaTask): number => {
	if (!a.dueAt && !b.dueAt) return a.title.localeCompare(b.title);
	if (!a.dueAt) return 1;
	if (!b.dueAt) return -1;
	return a.dueAt.localeCompare(b.dueAt) || a.title.localeCompare(b.title);
};

export const allDayOn = (events: AgendaEvent[], day: string): AgendaEvent[] =>
	events.filter((e) => e.allDay && localDay(e.startAt) <= day && day <= localDay(e.endAt || e.startAt));

const hourOf = (iso: string): number => {
	const d = new Date(iso);
	return d.getHours() + d.getMinutes() / 60;
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

/** Needs attention without the agent's view. Overdue tasks are only COUNTED:
 *  To do, by client already lists them in its Overdue group, and repeating the
 *  list here showed the same rows twice. Due-today tasks sit inside their
 *  client groups there, so they are still listed here (up to six). */
export const fallbackAttention = (tasks: AgendaTask[], today: string): { overdue: number; dueToday: AgendaTask[] } => ({
	overdue: tasks.filter((t) => t.status === 'overdue').length,
	dueToday: tasks.filter((t) => t.status !== 'overdue' && t.dueAt?.slice(0, 10) === today).sort(byDue).slice(0, 6)
});

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

// --- Source chips -----------------------------------------------------------
// One chip per source: its connection state and the action it offers. A pure
// function so the states are testable and so the component's `$:` sees every
// input it depends on — a chip computed inside a closure never re-rendered
// when the connectors arrived, and every provider read "connect" forever.

export interface SourceChip {
	source: AgendaSource | 'work';
	label: string;
	color: string;
	state: 'ok' | 'warn' | 'off';
	text: string;
	/** Open Meetings › Connections, where the work account is chosen and reconnected. */
	action?: 'connections';
}

/** Where the planner's one sign-in lives (one-sign-in spec §3.4). */
export const CONNECTIONS_HREF = '/x/salem/connectors';

export const sourceChip = (
	s: AgendaSource,
	sources: Partial<Record<AgendaSource, AgendaSourceStatus>>,
	connectors: ConnectorsResponse | null,
	time: (iso: string) => string
): SourceChip => {
	const { label, color } = SOURCE_META[s];
	const st = sources[s];
	if (s === 'xplan') {
		// XPLAN's connection is the debug Chrome; the chip is informational.
		if (st?.status === 'locked') return { source: s, label, color, state: 'warn', text: 'locked' };
		if (st?.status === 'ok') return { source: s, label, color, state: 'ok', text: st.readAt ? `read ${time(st.readAt)}` : 'read' };
		return { source: s, label, color, state: 'off', text: 'not read yet' };
	}
	const c = connectors?.[s as ConnectorProvider];
	// Not the work account: nothing is read from it here.
	if (!c || c.status === 'disconnected') return { source: s, label, color, state: 'off', text: 'not your work account' };
	if (c.status !== 'ok' || st?.status === 'error') return { source: s, label, color, state: 'warn', text: 'reconnect', action: 'connections' };
	// Connected before Mail.Send was asked for: sending/booking would refuse
	// with needs_reconnect, so say so here.
	if (c.missing_scopes?.length) return { source: s, label, color, state: 'warn', text: 'Reconnect to enable sending', action: 'connections' };
	return { source: s, label, color, state: 'ok', text: c.email ?? 'connected', action: 'connections' };
};

/** XPLAN, then the work account's provider only. With no work account, one
 *  chip that sends the planner to choose it — never a provider of its own. */
export const sourceChips = (
	sources: Partial<Record<AgendaSource, AgendaSourceStatus>>,
	connectors: ConnectorsResponse | null,
	time: (iso: string) => string
): SourceChip[] => {
	const xplan = sourceChip('xplan', sources, connectors, time);
	const work = (['m365', 'google'] as AgendaSource[])
		.map((s) => sourceChip(s, sources, connectors, time))
		.filter((c) => c.state !== 'off');
	if (work.length) return [xplan, ...work];
	return [xplan, { source: 'work', label: 'Work account', color: '#9ca3af', state: 'off', text: 'choose in Connections', action: 'connections' }];
};

// --- Week view ---------------------------------------------------------------
// The grid (CalendarView) runs Sunday to Saturday, so the week does too.

export const weekStartOf = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());

export const shiftWeek = (start: Date, weeks: number): Date =>
	new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * weeks);

export const weekWindow = (start: Date): { from: string; to: string } => ({
	from: isoDate(start),
	to: isoDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6))
});

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "11 – 17 Oct 2026"; the first month or year is named only when it differs. */
export const weekLabel = (start: Date): string => {
	const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
	const tail = `${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
	if (start.getFullYear() !== end.getFullYear()) return `${start.getDate()} ${MONTHS[start.getMonth()]} ${start.getFullYear()} – ${tail}`;
	if (start.getMonth() !== end.getMonth()) return `${start.getDate()} ${MONTHS[start.getMonth()]} – ${tail}`;
	return `${start.getDate()} – ${tail}`;
};

/** The hour the week grid opens at: Today's default start, or sooner when a
 *  timed event in the week starts before it. */
export const weekScrollHour = (events: AgendaEvent[]): number =>
	events.reduce((h, e) => (e.allDay ? h : Math.min(h, Math.floor(hourOf(e.startAt)))), DEFAULT_START);

/** The agent's narrative is one point per line; a bullet it wrote itself is dropped. */
export const narrativePoints = (text: string): string[] =>
	text.split('\n').map((l) => l.trim().replace(/^(?:[-•*]|\d+[.)])\s+/, '')).filter(Boolean);
