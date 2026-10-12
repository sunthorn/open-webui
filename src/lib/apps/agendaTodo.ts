// Pure logic behind the Briefing page's task list (TodoList.svelte): due
// buckets and labels, search and filters, sorting, grouping, counts. No
// Svelte, no fetch, no Intl — dates compare as local YYYY-MM-DD strings so the
// results hold in any time zone.
import type { AgendaSource, AgendaTask } from '$lib/apis/gateway/agenda';
import { isoDate } from '$lib/apis/gateway/agenda';
import { SOURCE_META, localDay } from '$lib/apps/agenda';

export type TodoGroupBy = 'due' | 'client' | 'source';
export type TodoSort = 'due' | 'title';
export type DueBucket = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'none';
/** The header strip's quick filters. */
export type QuickFilter = 'overdue' | 'today' | 'upcoming';
export type SnoozeChoice = 'tomorrow' | 'nextWeek';

export const SNOOZE_CHOICES: { choice: SnoozeChoice; label: string }[] = [
	{ choice: 'tomorrow', label: 'Tomorrow' },
	{ choice: 'nextWeek', label: 'In a week' }
];

export const GROUP_BY_OPTIONS: { value: TodoGroupBy; label: string }[] = [
	{ value: 'due', label: 'Due date' },
	{ value: 'client', label: 'Client' },
	{ value: 'source', label: 'Source' }
];

export const SORT_OPTIONS: { value: TodoSort; label: string }[] = [
	{ value: 'due', label: 'Due date' },
	{ value: 'title', label: 'Title A–Z' }
];

const DUE_ORDER: DueBucket[] = ['overdue', 'today', 'tomorrow', 'week', 'later', 'none'];
export const DUE_BUCKET_LABEL: Record<DueBucket, string> = {
	overdue: 'Overdue',
	today: 'Today',
	tomorrow: 'Tomorrow',
	week: 'This week',
	later: 'Later',
	none: 'No date'
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const parts = (day: string): [number, number, number] => {
	const [y, m, d] = day.split('-').map(Number);
	return [y, m, d];
};

export const shiftDay = (day: string, n: number): string => {
	const [y, m, d] = parts(day);
	return isoDate(new Date(y, m - 1, d + n));
};

/** Whole calendar days from `a` to `b` (b − a). UTC arithmetic, so DST never skews it. */
export const daysBetween = (a: string, b: string): number => {
	const [ay, am, ad] = parts(a);
	const [by, bm, bd] = parts(b);
	return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
};

/** The Saturday that closes today's week — the week runs Sunday to Saturday, like the calendar. */
export const weekEndOf = (today: string): string => {
	const [y, m, d] = parts(today);
	return shiftDay(today, 6 - new Date(y, m - 1, d).getDay());
};

export const dueDay = (t: AgendaTask): string | null => (t.dueAt ? localDay(t.dueAt) : null);

export const isDone = (t: AgendaTask): boolean => t.status === 'done';

/** Which due-date group a task belongs to. The source's own 'overdue' wins (a
 *  timestamp earlier today is overdue already); a done task keeps its date's
 *  bucket, so one finished late sits — struck through — under Overdue. */
export const dueBucket = (t: AgendaTask, today: string): DueBucket => {
	if (t.status === 'overdue') return 'overdue';
	const day = dueDay(t);
	if (!day) return 'none';
	if (day < today) return 'overdue';
	if (day === today) return 'today';
	if (day === shiftDay(today, 1)) return 'tomorrow';
	if (day <= weekEndOf(today)) return 'week';
	return 'later';
};

/** "Fri 17 Oct", with the year only when it isn't this one. */
export const shortDate = (day: string, today: string): string => {
	const [y, m, d] = parts(day);
	const wd = DAYS[new Date(y, m - 1, d).getDay()];
	return `${wd} ${d} ${MONTHS[m - 1]}${day.slice(0, 4) === today.slice(0, 4) ? '' : ` ${y}`}`;
};

/** "Overdue · 3 days", "Today", "Tomorrow", "Fri 17 Oct", or '' with no due date. */
export const dueLabel = (t: AgendaTask, today: string): string => {
	const day = dueDay(t);
	if (!isDone(t) && dueBucket(t, today) === 'overdue') {
		const n = day ? daysBetween(day, today) : 0;
		return n > 0 ? `Overdue · ${n} ${n === 1 ? 'day' : 'days'}` : 'Overdue';
	}
	if (!day) return '';
	if (day === today) return 'Today';
	if (day === shiftDay(today, 1)) return 'Tomorrow';
	if (day === shiftDay(today, -1)) return 'Yesterday';
	return shortDate(day, today);
};

export type DueTone = 'overdue' | 'today' | 'normal';
export const dueTone = (t: AgendaTask, today: string): DueTone => {
	if (isDone(t)) return 'normal';
	const b = dueBucket(t, today);
	return b === 'overdue' ? 'overdue' : b === 'today' ? 'today' : 'normal';
};

/** Every word must appear in the title, client, suggested client or detail. */
export const matchesQuery = (t: AgendaTask, query: string): boolean => {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return true;
	const hay = [t.title, t.client?.name, t.suggestion?.name, t.detail]
		.filter(Boolean)
		.join(' \n ')
		.toLowerCase();
	return words.every((w) => hay.includes(w));
};

export const matchesQuick = (t: AgendaTask, quick: QuickFilter | null, today: string): boolean => {
	if (!quick) return true;
	const b = dueBucket(t, today);
	if (quick === 'upcoming') return b === 'tomorrow' || b === 'week' || b === 'later';
	return b === quick;
};

export interface TodoFilters {
	query: string;
	/** Sources switched off in the filter bar. */
	hiddenSources: AgendaSource[];
	showCompleted: boolean;
	quick: QuickFilter | null;
}

export const DEFAULT_FILTERS: TodoFilters = {
	query: '',
	hiddenSources: [],
	showCompleted: false,
	quick: null
};

/** True when any filter narrows the list (Show completed only widens it). */
export const filtersActive = (f: TodoFilters): boolean =>
	f.query.trim() !== '' || f.hiddenSources.length > 0 || f.quick !== null;

export const filterTasks = (tasks: AgendaTask[], f: TodoFilters, today: string): AgendaTask[] =>
	tasks.filter(
		(t) =>
			(f.showCompleted || !isDone(t)) &&
			!f.hiddenSources.includes(t.source) &&
			matchesQuick(t, f.quick, today) &&
			matchesQuery(t, f.query)
	);

const dueMs = (t: AgendaTask): number => {
	if (!t.dueAt) return 0;
	const ms = Date.parse(t.dueAt.length <= 10 ? `${t.dueAt}T00:00:00` : t.dueAt);
	return isNaN(ms) ? 0 : ms;
};
const byTitle = (a: AgendaTask, b: AgendaTask): number =>
	a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id);

/** Open before done; then due day (undated last), due time, title — or title A–Z. */
export const compareTasks =
	(sort: TodoSort) =>
	(a: AgendaTask, b: AgendaTask): number => {
		const done = Number(isDone(a)) - Number(isDone(b));
		if (done) return done;
		if (sort === 'title') return byTitle(a, b);
		const da = dueDay(a);
		const db = dueDay(b);
		if (da !== db) {
			if (!da) return 1;
			if (!db) return -1;
			return da < db ? -1 : 1;
		}
		return dueMs(a) - dueMs(b) || byTitle(a, b);
	};

export const sortTasks = (tasks: AgendaTask[], sort: TodoSort): AgendaTask[] =>
	[...tasks].sort(compareTasks(sort));

export interface TodoGroup {
	key: string;
	label: string;
	tone: 'danger' | 'accent' | 'default' | 'muted';
	/** A source group's colour dot. */
	color?: string;
	tasks: AgendaTask[];
	openCount: number;
	doneCount: number;
}

const finish = (g: Omit<TodoGroup, 'openCount' | 'doneCount'>, sort: TodoSort): TodoGroup => {
	const tasks = sortTasks(g.tasks, sort);
	const doneCount = tasks.filter(isDone).length;
	return { ...g, tasks, doneCount, openCount: tasks.length - doneCount };
};

/** Groups for the list; empty groups are left out. Keys are prefixed with the
 *  grouping so a collapsed "Today" never collapses a client called Today. */
export const groupTodos = (
	tasks: AgendaTask[],
	by: TodoGroupBy,
	sort: TodoSort,
	today: string
): TodoGroup[] => {
	if (by === 'due') {
		const buckets = new Map<DueBucket, AgendaTask[]>();
		for (const t of tasks) {
			const b = dueBucket(t, today);
			buckets.set(b, [...(buckets.get(b) ?? []), t]);
		}
		return DUE_ORDER.filter((b) => buckets.has(b)).map((b) =>
			finish(
				{
					key: `due:${b}`,
					label: DUE_BUCKET_LABEL[b],
					tone:
						b === 'overdue'
							? 'danger'
							: b === 'today'
								? 'accent'
								: b === 'none'
									? 'muted'
									: 'default',
					tasks: buckets.get(b)!
				},
				sort
			)
		);
	}
	if (by === 'source') {
		return (Object.keys(SOURCE_META) as AgendaSource[])
			.map((s) => ({ s, list: tasks.filter((t) => t.source === s) }))
			.filter(({ list }) => list.length)
			.map(({ s, list }) =>
				finish(
					{
						key: `source:${s}`,
						label: SOURCE_META[s].label,
						tone: 'default',
						color: SOURCE_META[s].color,
						tasks: list
					},
					sort
				)
			);
	}
	const clients = new Map<string, { label: string; tasks: AgendaTask[] }>();
	const unassigned: AgendaTask[] = [];
	for (const t of tasks) {
		if (!t.client) {
			unassigned.push(t);
			continue;
		}
		const g = clients.get(t.client.id) ?? { label: t.client.name, tasks: [] };
		g.tasks.push(t);
		clients.set(t.client.id, g);
	}
	const out = [...clients.entries()]
		.sort(([, a], [, b]) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
		.map(([id, g]) =>
			finish({ key: `client:${id}`, label: g.label, tone: 'default', tasks: g.tasks }, sort)
		);
	if (unassigned.length)
		out.push(
			finish(
				{ key: 'client:~unassigned', label: 'Unassigned', tone: 'muted', tasks: unassigned },
				sort
			)
		);
	return out;
};

/** The header strip: open tasks only, before any filter. */
export const todoCounts = (
	tasks: AgendaTask[],
	today: string
): { overdue: number; today: number; upcoming: number; open: number; done: number } => {
	const c = { overdue: 0, today: 0, upcoming: 0, open: 0, done: 0 };
	for (const t of tasks) {
		if (isDone(t)) {
			c.done++;
			continue;
		}
		c.open++;
		const b = dueBucket(t, today);
		if (b === 'overdue') c.overdue++;
		else if (b === 'today') c.today++;
		else if (b !== 'none') c.upcoming++;
	}
	return c;
};

/** Why the checkbox can't complete this task, or null when it can. */
export const completeBlock = (
	t: AgendaTask,
	xplanLocked: boolean,
	busyId: string | null
): string | null => {
	if (isDone(t)) return 'Already done';
	if (busyId === t.id) return 'Working…';
	if (!t.writable)
		return `Read-only here — ${SOURCE_META[t.source].openLabel.toLowerCase()} to complete it`;
	if (t.source === 'xplan' && xplanLocked) return 'XPLAN access is locked';
	return null;
};

/** Opening the source is blocked only for XPLAN while it is locked. */
export const openBlocked = (t: AgendaTask, xplanLocked: boolean): boolean =>
	t.source === 'xplan' && xplanLocked;

/** The row after (+1) or before (−1) `current` in display order, clamped; the first row when nothing is focused. */
export const stepFocus = (ids: string[], current: string | null, delta: 1 | -1): string | null => {
	if (!ids.length) return null;
	const i = current ? ids.indexOf(current) : -1;
	if (i < 0) return delta > 0 ? ids[0] : ids[ids.length - 1];
	return ids[Math.min(ids.length - 1, Math.max(0, i + delta))];
};

// --- persisted view preferences (per viewer, best effort) -------------------

export const TODO_PREFS_KEY = 'axi.briefing.todo.v1';

export interface TodoPrefs {
	groupBy: TodoGroupBy;
	sort: TodoSort;
	showCompleted: boolean;
	collapsed: Record<string, boolean>;
}

export const DEFAULT_PREFS: TodoPrefs = {
	groupBy: 'due',
	sort: 'due',
	showCompleted: false,
	collapsed: {}
};

/** Whatever was stored, coerced back to valid prefs; junk falls back to the defaults. */
export const parsePrefs = (raw: string | null): TodoPrefs => {
	if (!raw) return { ...DEFAULT_PREFS, collapsed: {} };
	try {
		const v = JSON.parse(raw) ?? {};
		const collapsed: Record<string, boolean> = {};
		if (v.collapsed && typeof v.collapsed === 'object')
			for (const [k, on] of Object.entries(v.collapsed)) if (on === true) collapsed[k] = true;
		return {
			groupBy: GROUP_BY_OPTIONS.some((o) => o.value === v.groupBy)
				? v.groupBy
				: DEFAULT_PREFS.groupBy,
			sort: SORT_OPTIONS.some((o) => o.value === v.sort) ? v.sort : DEFAULT_PREFS.sort,
			showCompleted: v.showCompleted === true,
			collapsed
		};
	} catch {
		return { ...DEFAULT_PREFS, collapsed: {} };
	}
};
