// Pure date and layout logic behind AgendaCalendar (Briefing's calendar).
// No Svelte, no fetch — vitest holds it to account. Every date is a LOCAL
// calendar day ('YYYY-MM-DD') or a local minute-of-day, and every day is
// built with the Date(y, m, d) constructor so DST days (23 or 25 hours long)
// never shift a date. Rendering lives in src/lib/components/agenda/calendar/*.
import type { AgendaEvent } from '$lib/apis/gateway/agenda';
import { isoDate } from '$lib/apis/gateway/agenda';
import { localDay, weekStartOf } from '$lib/apps/agenda';

export type CalView = 'day' | 'workweek' | 'week' | 'month' | 'agenda';
export const CAL_VIEWS: CalView[] = ['day', 'workweek', 'week', 'month', 'agenda'];
export const VIEW_LABEL: Record<CalView, string> = {
	day: 'Day',
	workweek: 'Work week',
	week: 'Week',
	month: 'Month',
	agenda: 'Agenda'
};

/** Days the Agenda view lists from its anchor. */
export const AGENDA_DAYS = 14;
/** The gateway answers at most this many days per GET (agenda-spec §GET /gw/agenda). */
export const MAX_FETCH_DAYS = 31;
const DAY_MIN = 24 * 60;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// --- days --------------------------------------------------------------------

/** 'YYYY-MM-DD' → local midnight. */
export const parseDay = (day: string): Date => {
	const [y, m, d] = day.split('-').map(Number);
	return new Date(y, m - 1, d);
};

export const addDays = (day: string, n: number): string => {
	const d = parseDay(day);
	return isoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
};

/** Whole calendar days from a to b (b − a); DST-safe because it counts dates, not ms. */
export const daysBetween = (a: string, b: string): number => {
	const da = parseDay(a);
	const db = parseDay(b);
	return Math.round(
		(Date.UTC(db.getFullYear(), db.getMonth(), db.getDate()) -
			Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())) /
			86_400_000
	);
};

export const dayList = (from: string, to: string): string[] => {
	const n = daysBetween(from, to);
	return Array.from({ length: Math.max(0, n + 1) }, (_, i) => addDays(from, i));
};

export const weekdayOf = (day: string): number => parseDay(day).getDay();
export const isWeekend = (day: string): boolean => [0, 6].includes(weekdayOf(day));

/** Wall-clock minutes since the start of `day` for an instant: 09:30 that day is 570 even
 *  on a DST day, so blocks line up with the hour labels; the day before is negative and
 *  the day after is 1440 or more. */
export const minuteOfDay = (iso: string | Date, day: string): number => {
	const d = typeof iso === 'string' ? new Date(iso) : iso;
	return (
		daysBetween(day, isoDate(d)) * DAY_MIN +
		d.getHours() * 60 +
		d.getMinutes() +
		d.getSeconds() / 60
	);
};

// --- views ----------------------------------------------------------------------

export interface ViewRange {
	from: string;
	to: string;
	/** The days drawn as columns (time grid), cells (month) or rows (agenda). */
	days: string[];
}

/** The 42 days of the month grid around `anchor`'s month, Sunday first. */
export const monthGrid = (anchor: string): { day: string; inMonth: boolean }[] => {
	const a = parseDay(anchor);
	const first = new Date(a.getFullYear(), a.getMonth(), 1);
	const start = isoDate(weekStartOf(first));
	return Array.from({ length: 42 }, (_, i) => {
		const day = addDays(start, i);
		return { day, inMonth: parseDay(day).getMonth() === a.getMonth() };
	});
};

export const viewRange = (view: CalView, anchor: string): ViewRange => {
	let from: string;
	let to: string;
	switch (view) {
		case 'day':
			from = to = anchor;
			break;
		case 'workweek':
			from = addDays(isoDate(weekStartOf(parseDay(anchor))), 1);
			to = addDays(from, 4);
			break;
		case 'week':
			from = isoDate(weekStartOf(parseDay(anchor)));
			to = addDays(from, 6);
			break;
		case 'month': {
			const g = monthGrid(anchor);
			from = g[0].day;
			to = g[g.length - 1].day;
			break;
		}
		case 'agenda':
			from = anchor;
			to = addDays(anchor, AGENDA_DAYS - 1);
			break;
	}
	return { from, to, days: dayList(from, to) };
};

/** The anchor one step back (dir −1) or forward (+1) in `view`. Month lands on the 1st. */
export const stepAnchor = (view: CalView, anchor: string, dir: number): string => {
	switch (view) {
		case 'day':
			return addDays(anchor, dir);
		case 'workweek':
		case 'week':
			return addDays(anchor, 7 * dir);
		case 'month': {
			const a = parseDay(anchor);
			return isoDate(new Date(a.getFullYear(), a.getMonth() + dir, 1));
		}
		case 'agenda':
			return addDays(anchor, AGENDA_DAYS * dir);
	}
};

/** "13 Oct 2026"-style range label; the first month or year is named only when it differs. */
export const rangeLabel = (from: string, to: string): string => {
	const s = parseDay(from);
	const e = parseDay(to);
	const tail = `${e.getDate()} ${MONTHS[e.getMonth()]} ${e.getFullYear()}`;
	if (from === to) return tail;
	if (s.getFullYear() !== e.getFullYear())
		return `${s.getDate()} ${MONTHS[s.getMonth()]} ${s.getFullYear()} – ${tail}`;
	if (s.getMonth() !== e.getMonth()) return `${s.getDate()} ${MONTHS[s.getMonth()]} – ${tail}`;
	return `${s.getDate()} – ${tail}`;
};

export const monthTitle = (day: string): string => {
	const d = parseDay(day);
	return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
};

export const dayTitle = (day: string): string => {
	const d = parseDay(day);
	return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

export const viewTitle = (view: CalView, anchor: string): string => {
	if (view === 'month') return monthTitle(anchor);
	if (view === 'day') return dayTitle(anchor);
	const r = viewRange(view, anchor);
	return rangeLabel(r.from, r.to);
};

export const weekdayShort = (day: string): string => WEEKDAYS[weekdayOf(day)];
export const monthShort = (day: string): string => MONTHS[parseDay(day).getMonth()];

/** Split an inclusive range into GETs the gateway accepts (≤ max days each). */
export const chunkRange = (
	from: string,
	to: string,
	max = MAX_FETCH_DAYS
): { from: string; to: string }[] => {
	const out: { from: string; to: string }[] = [];
	let s = from;
	while (daysBetween(s, to) >= 0) {
		const e = daysBetween(s, to) + 1 > max ? addDays(s, max - 1) : to;
		out.push({ from: s, to: e });
		s = addDays(e, 1);
	}
	return out;
};

/** True when [from, to] sits inside [wFrom, wTo] (all inclusive days). */
export const rangeInside = (from: string, to: string, wFrom: string, wTo: string): boolean =>
	from >= wFrom && to <= wTo;

/** Several answers, one list: an event that two chunks both returned appears once. */
export const mergeEvents = (lists: AgendaEvent[][]): AgendaEvent[] => {
	const seen = new Map<string, AgendaEvent>();
	for (const l of lists) for (const e of l) if (!seen.has(e.id)) seen.set(e.id, e);
	return [...seen.values()];
};

// --- which row an event belongs in -----------------------------------------------

const durationMin = (e: AgendaEvent): number =>
	(Date.parse(e.endAt || e.startAt) - Date.parse(e.startAt)) / 60_000;

/** All-day events, and timed ones of 24 h or more, ride in the all-day row (as Google does). */
export const isSpanning = (e: AgendaEvent): boolean => e.allDay || durationMin(e) >= DAY_MIN;

/** First and last local day an event covers (all-day endAt is inclusive per the contract;
 *  a timed event ending exactly at midnight does not cover the next day). */
export const eventDays = (e: AgendaEvent): { first: string; last: string } => {
	const first = localDay(e.startAt);
	if (e.allDay) {
		const last = localDay(e.endAt || e.startAt);
		return { first, last: last < first ? first : last };
	}
	const end = new Date(e.endAt || e.startAt);
	let last = isoDate(end);
	if (last > first && end.getHours() === 0 && end.getMinutes() === 0) last = addDays(last, -1);
	return { first, last };
};

export const coversDay = (e: AgendaEvent, day: string): boolean => {
	const { first, last } = eventDays(e);
	return first <= day && day <= last;
};

const byStart = (a: AgendaEvent, b: AgendaEvent): number =>
	Date.parse(a.startAt) - Date.parse(b.startAt) ||
	durationMin(b) - durationMin(a) ||
	a.title.localeCompare(b.title);

/** One day's events for the month cell and agenda list: spanning first, then timed by start. */
export const dayEvents = (
	events: AgendaEvent[],
	day: string
): { spanning: AgendaEvent[]; timed: AgendaEvent[] } => {
	const on = events.filter((e) => coversDay(e, day));
	return {
		spanning: on.filter(isSpanning).sort(byStart),
		// An event carried over from the night before sorts as if it began at midnight.
		timed: on
			.filter((e) => !isSpanning(e))
			.sort(
				(a, b) =>
					Math.max(0, minuteOfDay(a.startAt, day)) - Math.max(0, minuteOfDay(b.startAt, day)) ||
					byStart(a, b)
			)
	};
};

// --- time-grid layout: overlapping events side by side --------------------------

export interface TimedBlock {
	event: AgendaEvent;
	/** Minutes from the day's local midnight, clipped to the day. */
	startMin: number;
	endMin: number;
	/** Column within its overlap cluster, and how many columns the cluster has. */
	col: number;
	cols: number;
	/** Columns it may stretch over (≥1): free neighbours to its right. */
	span: number;
	/** It started before this day / runs past it. */
	continuesBefore: boolean;
	continuesAfter: boolean;
}

/** Lay out one day's timed events (classic interval-graph columns). Blocks shorter than
 *  `minMinutes` are treated as that long for overlap, matching how tall they are drawn. */
export const layoutDay = (events: AgendaEvent[], day: string, minMinutes = 20): TimedBlock[] => {
	const len = DAY_MIN;
	const items = events
		.filter((e) => !isSpanning(e) && coversDay(e, day))
		.sort(byStart)
		.map((event) => {
			const s = minuteOfDay(event.startAt, day);
			const en = minuteOfDay(event.endAt || event.startAt, day);
			const startMin = Math.max(0, s);
			const endMin = Math.min(len, Math.max(en, s));
			return {
				event,
				startMin,
				endMin,
				visEnd: Math.min(len, Math.max(endMin, startMin + minMinutes)),
				col: 0,
				cols: 1,
				span: 1,
				continuesBefore: s < 0,
				continuesAfter: en > len
			};
		});

	const out: TimedBlock[] = [];
	let cluster: typeof items = [];
	let colEnds: number[] = [];
	let clusterEnd = -Infinity;
	const flush = () => {
		const cols = colEnds.length;
		for (const it of cluster) {
			it.cols = cols;
			// Stretch right across columns no one in the cluster uses during this block.
			let span = 1;
			for (let c = it.col + 1; c < cols; c++) {
				const blocked = cluster.some(
					(o) => o.col === c && o.startMin < it.visEnd && it.startMin < o.visEnd
				);
				if (blocked) break;
				span++;
			}
			it.span = span;
			const { visEnd: _v, ...block } = it;
			out.push(block);
		}
		cluster = [];
		colEnds = [];
		clusterEnd = -Infinity;
	};
	for (const it of items) {
		if (it.startMin >= clusterEnd && cluster.length) flush();
		let col = colEnds.findIndex((end) => end <= it.startMin);
		if (col === -1) {
			col = colEnds.length;
			colEnds.push(it.visEnd);
		} else colEnds[col] = it.visEnd;
		it.col = col;
		cluster.push(it);
		clusterEnd = Math.max(clusterEnd, it.visEnd);
	}
	if (cluster.length) flush();
	return out;
};

/** Horizontal place of a block in its day column, in percent. A block with a column to
 *  its right overlaps into it (×1.7, as Google Calendar does) so titles stay readable;
 *  the later column draws on top. The last column keeps its exact width. */
export const blockGeometry = (
	b: Pick<TimedBlock, 'col' | 'cols' | 'span'>
): { left: number; width: number } => {
	const left = (b.col / b.cols) * 100;
	const exact = (b.span / b.cols) * 100;
	if (b.col + b.span >= b.cols) return { left, width: exact };
	return { left, width: Math.min(100 - left, exact * 1.7) };
};

// --- all-day row: multi-day events span columns ----------------------------------

export interface SpanBlock {
	event: AgendaEvent;
	/** Index into `days` of its first visible column, and how many columns it covers. */
	startCol: number;
	span: number;
	lane: number;
	continuesBefore: boolean;
	continuesAfter: boolean;
}

export const layoutSpanning = (events: AgendaEvent[], days: string[]): SpanBlock[] => {
	if (!days.length) return [];
	const from = days[0];
	const to = days[days.length - 1];
	const items = events
		.filter(isSpanning)
		.map((event) => ({ event, ...eventDays(event) }))
		.filter((x) => x.first <= to && x.last >= from)
		.sort(
			(a, b) =>
				a.first.localeCompare(b.first) ||
				daysBetween(b.first, b.last) - daysBetween(a.first, a.last) ||
				a.event.title.localeCompare(b.event.title)
		);
	const laneEnds: number[] = [];
	return items.map(({ event, first, last }) => {
		const startCol = Math.max(0, daysBetween(from, first));
		const endCol = Math.min(days.length - 1, daysBetween(from, last));
		let lane = laneEnds.findIndex((end) => end < startCol);
		if (lane === -1) {
			lane = laneEnds.length;
			laneEnds.push(endCol);
		} else laneEnds[lane] = endCol;
		return {
			event,
			startCol,
			span: endCol - startCol + 1,
			lane,
			continuesBefore: first < from,
			continuesAfter: last > to
		};
	});
};

// --- drag to reschedule ------------------------------------------------------------

export const SNAP_MIN = 15;

export const snap = (min: number, step = SNAP_MIN): number => Math.round(min / step) * step;

/** A pointer's y within a day column → minutes since midnight (unsnapped). */
export const minutesAt = (y: number, hourPx: number): number => (y / hourPx) * 60;

/** ISO with an explicit offset, as the gateway wants (same shape as moveWindow). */
const toIso = (d: Date): string => d.toISOString().replace('Z', '+00:00');

const atMinute = (day: string, min: number): Date => {
	const d = parseDay(day);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, min);
};

/** Where a dragged block lands: the pointer's minute less where it was grabbed, snapped,
 *  kept inside the day; duration is kept, so the end may run past midnight. */
export const dropStart = (pointerMin: number, grabOffsetMin: number): number =>
	Math.min(Math.max(0, snap(pointerMin - grabOffsetMin)), DAY_MIN - SNAP_MIN);

/** A moved event's new times: same duration, starting at `startMin` on `day`. */
export const movedTimes = (
	e: AgendaEvent,
	day: string,
	startMin: number
): { startAt: string; endAt: string } => {
	const dur = Date.parse(e.endAt || e.startAt) - Date.parse(e.startAt);
	const s = atMinute(day, startMin);
	return { startAt: toIso(s), endAt: toIso(new Date(s.getTime() + Math.max(dur, 0))) };
};

/** Bottom-edge resize: the end snaps to the pointer's minute on the event's start day,
 *  never closer than one snap step to the start. */
export const resizedTimes = (
	e: AgendaEvent,
	pointerMin: number
): { startAt: string; endAt: string } => {
	const day = localDay(e.startAt);
	const startMin = minuteOfDay(e.startAt, day);
	const endMin = Math.max(snap(pointerMin), startMin + SNAP_MIN);
	return { startAt: toIso(new Date(e.startAt)), endAt: toIso(atMinute(day, endMin)) };
};

/** True when a proposed move actually changes the event. */
export const timesChanged = (e: AgendaEvent, t: { startAt: string; endAt: string }): boolean =>
	Date.parse(t.startAt) !== Date.parse(e.startAt) ||
	Date.parse(t.endAt) !== Date.parse(e.endAt || e.startAt);

// --- display -----------------------------------------------------------------------

const p2 = (n: number) => String(n).padStart(2, '0');
export const hhmm = (iso: string | Date): string => {
	const d = typeof iso === 'string' ? new Date(iso) : iso;
	return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
};
export const minLabel = (min: number): string => {
	const m = ((Math.round(min) % DAY_MIN) + DAY_MIN) % DAY_MIN;
	return `${p2(Math.floor(m / 60))}:${p2(m % 60)}`;
};
