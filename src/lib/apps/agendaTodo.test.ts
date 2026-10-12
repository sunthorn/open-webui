import { describe, it, expect } from 'vitest';
import type { AgendaTask } from '$lib/apis/gateway/agenda';
import {
	shiftDay,
	daysBetween,
	weekEndOf,
	dueBucket,
	dueLabel,
	dueTone,
	shortDate,
	matchesQuery,
	matchesQuick,
	filterTasks,
	filtersActive,
	sortTasks,
	groupTodos,
	todoCounts,
	completeBlock,
	openBlocked,
	stepFocus,
	parsePrefs,
	DEFAULT_FILTERS,
	DEFAULT_PREFS
} from './agendaTodo';

const task = (over: Partial<AgendaTask>): AgendaTask => ({
	id: 'google:l~x',
	source: 'google',
	sourceId: 'l~x',
	title: 't',
	status: 'open',
	href: 'h',
	writable: false,
	...over
});
// Build ISO strings in LOCAL time so the tests hold in any zone.
const local = (y: number, m: number, d: number, h: number, min = 0) =>
	new Date(y, m - 1, d, h, min).toISOString();
// Tuesday 14 Oct 2026 — its week runs Sun 12 to Sat 18.
const TODAY = '2026-10-14';
const ids = (ts: AgendaTask[]) => ts.map((t) => t.id);

describe('day arithmetic', () => {
	it('shifts across month and year ends', () => {
		expect(shiftDay('2026-10-31', 1)).toBe('2026-11-01');
		expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
		expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
	});

	it('counts whole days, including across a DST change', () => {
		expect(daysBetween('2026-10-11', '2026-10-14')).toBe(3);
		expect(daysBetween('2026-10-01', '2026-10-08')).toBe(7); // AU DST starts 4 Oct
		expect(daysBetween('2026-03-25', '2026-04-08')).toBe(14); // EU/US/AU changes
		expect(daysBetween('2026-10-14', '2026-10-11')).toBe(-3);
	});

	it('ends the week on Saturday, like the calendar grid', () => {
		expect(weekEndOf('2026-10-14')).toBe('2026-10-17'); // Wed → Sat
		expect(weekEndOf('2026-10-11')).toBe('2026-10-17'); // Sun → Sat
		expect(weekEndOf('2026-10-17')).toBe('2026-10-17'); // Sat → itself
		expect(weekEndOf('2026-12-29')).toBe('2027-01-02'); // across the year
	});
});

describe('dueBucket', () => {
	it('sorts dates into overdue / today / tomorrow / this week / later / none', () => {
		expect(dueBucket(task({ dueAt: '2026-10-13' }), TODAY)).toBe('overdue');
		expect(dueBucket(task({ dueAt: '2026-10-14' }), TODAY)).toBe('today');
		expect(dueBucket(task({ dueAt: '2026-10-15' }), TODAY)).toBe('tomorrow');
		expect(dueBucket(task({ dueAt: '2026-10-16' }), TODAY)).toBe('week');
		expect(dueBucket(task({ dueAt: '2026-10-17' }), TODAY)).toBe('week');
		expect(dueBucket(task({ dueAt: '2026-10-18' }), TODAY)).toBe('later');
		expect(dueBucket(task({}), TODAY)).toBe('none');
	});

	it("trusts the source's overdue status, even with today's date or no date", () => {
		expect(dueBucket(task({ status: 'overdue', dueAt: local(2026, 10, 14, 9) }), TODAY)).toBe(
			'overdue'
		);
		expect(dueBucket(task({ status: 'overdue' }), TODAY)).toBe('overdue');
	});

	it('reads a timestamp as its local day', () => {
		expect(dueBucket(task({ dueAt: local(2026, 10, 14, 23, 30) }), TODAY)).toBe('today');
		expect(dueBucket(task({ dueAt: local(2026, 10, 15, 0, 15) }), TODAY)).toBe('tomorrow');
	});

	it('has no "this week" left when tomorrow closes the week', () => {
		const fri = '2026-10-16';
		expect(dueBucket(task({ dueAt: '2026-10-17' }), fri)).toBe('tomorrow');
		expect(dueBucket(task({ dueAt: '2026-10-18' }), fri)).toBe('later');
		const sat = '2026-10-17';
		expect(dueBucket(task({ dueAt: '2026-10-18' }), sat)).toBe('tomorrow');
		expect(dueBucket(task({ dueAt: '2026-10-19' }), sat)).toBe('later');
	});

	it('keeps a done task in its date bucket', () => {
		expect(dueBucket(task({ status: 'done', dueAt: '2026-10-10' }), TODAY)).toBe('overdue');
		expect(dueBucket(task({ status: 'done', dueAt: '2026-10-14' }), TODAY)).toBe('today');
	});
});

describe('dueLabel', () => {
	it('labels overdue with whole days, singular and plural', () => {
		expect(dueLabel(task({ dueAt: '2026-10-11', status: 'overdue' }), TODAY)).toBe(
			'Overdue · 3 days'
		);
		expect(dueLabel(task({ dueAt: '2026-10-13' }), TODAY)).toBe('Overdue · 1 day');
		expect(dueLabel(task({ dueAt: local(2026, 10, 14, 8), status: 'overdue' }), TODAY)).toBe(
			'Overdue'
		);
		expect(dueLabel(task({ status: 'overdue' }), TODAY)).toBe('Overdue');
	});

	it('says Today, Tomorrow, or the short date', () => {
		expect(dueLabel(task({ dueAt: '2026-10-14' }), TODAY)).toBe('Today');
		expect(dueLabel(task({ dueAt: local(2026, 10, 15, 10) }), TODAY)).toBe('Tomorrow');
		expect(dueLabel(task({ dueAt: '2026-10-16' }), TODAY)).toBe('Fri 16 Oct');
		expect(dueLabel(task({ dueAt: '2027-01-05' }), TODAY)).toBe('Tue 5 Jan 2027');
		expect(dueLabel(task({}), TODAY)).toBe('');
	});

	it('gives a done task its date, never "Overdue"', () => {
		expect(dueLabel(task({ status: 'done', dueAt: '2026-10-13' }), TODAY)).toBe('Yesterday');
		expect(dueLabel(task({ status: 'done', dueAt: '2026-10-09' }), TODAY)).toBe('Fri 9 Oct');
		expect(dueLabel(task({ status: 'done' }), TODAY)).toBe('');
	});

	it('tones overdue and today, but not done', () => {
		expect(dueTone(task({ dueAt: '2026-10-01' }), TODAY)).toBe('overdue');
		expect(dueTone(task({ dueAt: '2026-10-14' }), TODAY)).toBe('today');
		expect(dueTone(task({ dueAt: '2026-10-20' }), TODAY)).toBe('normal');
		expect(dueTone(task({ dueAt: '2026-10-01', status: 'done' }), TODAY)).toBe('normal');
	});

	it('shortDate names the weekday', () => {
		expect(shortDate('2026-10-17', TODAY)).toBe('Sat 17 Oct');
	});
});

describe('search and filters', () => {
	const t = task({
		title: 'Send SOA',
		client: { id: 'c1', name: 'Adams, Jane', via: 'rule' },
		suggestion: undefined,
		detail: 'Super rollover paperwork'
	});

	it('matches every word across title, client, suggestion and detail, case-insensitively', () => {
		expect(matchesQuery(t, '')).toBe(true);
		expect(matchesQuery(t, '  ')).toBe(true);
		expect(matchesQuery(t, 'soa')).toBe(true);
		expect(matchesQuery(t, 'adams rollover')).toBe(true);
		expect(matchesQuery(t, 'adams pension')).toBe(false);
		expect(
			matchesQuery(task({ suggestion: { clientId: 'b', name: 'Bragg', confidence: 0.8 } }), 'bragg')
		).toBe(true);
	});

	it('quick filters by bucket; upcoming is any future date', () => {
		expect(matchesQuick(task({ dueAt: '2026-10-01' }), 'overdue', TODAY)).toBe(true);
		expect(matchesQuick(task({ dueAt: '2026-10-14' }), 'today', TODAY)).toBe(true);
		expect(matchesQuick(task({ dueAt: '2026-10-15' }), 'upcoming', TODAY)).toBe(true);
		expect(matchesQuick(task({ dueAt: '2026-12-15' }), 'upcoming', TODAY)).toBe(true);
		expect(matchesQuick(task({}), 'upcoming', TODAY)).toBe(false);
		expect(matchesQuick(task({}), null, TODAY)).toBe(true);
	});

	it('hides done tasks unless asked, and hidden sources always', () => {
		const tasks = [
			task({ id: 'a', source: 'xplan' }),
			task({ id: 'b', source: 'm365', status: 'done' }),
			task({ id: 'c', source: 'google', title: 'call bank' })
		];
		expect(ids(filterTasks(tasks, DEFAULT_FILTERS, TODAY))).toEqual(['a', 'c']);
		expect(ids(filterTasks(tasks, { ...DEFAULT_FILTERS, showCompleted: true }, TODAY))).toEqual([
			'a',
			'b',
			'c'
		]);
		expect(
			ids(filterTasks(tasks, { ...DEFAULT_FILTERS, hiddenSources: ['xplan'] }, TODAY))
		).toEqual(['c']);
		expect(ids(filterTasks(tasks, { ...DEFAULT_FILTERS, query: 'bank' }, TODAY))).toEqual(['c']);
	});

	it('filtersActive ignores Show completed', () => {
		expect(filtersActive(DEFAULT_FILTERS)).toBe(false);
		expect(filtersActive({ ...DEFAULT_FILTERS, showCompleted: true })).toBe(false);
		expect(filtersActive({ ...DEFAULT_FILTERS, query: 'x' })).toBe(true);
		expect(filtersActive({ ...DEFAULT_FILTERS, hiddenSources: ['m365'] })).toBe(true);
		expect(filtersActive({ ...DEFAULT_FILTERS, quick: 'today' })).toBe(true);
	});
});

describe('sortTasks', () => {
	const tasks = [
		task({ id: '1', title: 'zeta', dueAt: '2026-10-16' }),
		task({ id: '2', title: 'alpha' }),
		task({ id: '3', title: 'Beta', dueAt: local(2026, 10, 14, 15) }),
		task({ id: '4', title: 'gamma', dueAt: local(2026, 10, 14, 9) }),
		task({ id: '5', title: 'done one', dueAt: '2026-10-01', status: 'done' }),
		task({ id: '6', title: 'delta', dueAt: '2026-10-14' })
	];

	it('by due: day, then time (bare date first), then title; undated last; done at the bottom', () => {
		expect(ids(sortTasks(tasks, 'due'))).toEqual(['6', '4', '3', '1', '2', '5']);
	});

	it('by title: A–Z ignoring case; done still at the bottom', () => {
		expect(ids(sortTasks(tasks, 'title'))).toEqual(['2', '3', '6', '4', '1', '5']);
	});

	it('does not mutate its input', () => {
		const copy = [...tasks];
		sortTasks(tasks, 'title');
		expect(tasks).toEqual(copy);
	});
});

describe('groupTodos', () => {
	const adams = { id: 'a', name: 'Adams, J', via: 'pin' as const };
	const bragg = { id: 'b', name: 'bragg, M', via: 'rule' as const };
	const tasks = [
		task({ id: 'od', dueAt: '2026-10-02', status: 'overdue', source: 'xplan', client: bragg }),
		task({ id: 'td', dueAt: '2026-10-14', source: 'm365', client: adams }),
		task({ id: 'wk', dueAt: '2026-10-17', source: 'xplan' }),
		task({ id: 'lt', dueAt: '2026-11-30', source: 'google', client: adams }),
		task({ id: 'nd', source: 'google' }),
		task({ id: 'dn', dueAt: '2026-10-14', status: 'done', source: 'm365', title: 'aaa' })
	];

	it('by due: fixed order, empty buckets left out, done last with counts', () => {
		const g = groupTodos(tasks, 'due', 'due', TODAY);
		expect(g.map((x) => x.key)).toEqual([
			'due:overdue',
			'due:today',
			'due:week',
			'due:later',
			'due:none'
		]);
		expect(g.map((x) => x.label)).toEqual(['Overdue', 'Today', 'This week', 'Later', 'No date']);
		expect(g[0].tone).toBe('danger');
		expect(ids(g[1].tasks)).toEqual(['td', 'dn']);
		expect([g[1].openCount, g[1].doneCount]).toEqual([1, 1]);
	});

	it('by client: A–Z ignoring case, overdue stays with its client, unassigned last', () => {
		const g = groupTodos(tasks, 'client', 'due', TODAY);
		expect(g.map((x) => [x.key, x.label])).toEqual([
			['client:a', 'Adams, J'],
			['client:b', 'bragg, M'],
			['client:~unassigned', 'Unassigned']
		]);
		expect(ids(g[0].tasks)).toEqual(['td', 'lt']);
		expect(ids(g[1].tasks)).toEqual(['od']);
		expect(ids(g[2].tasks)).toEqual(['wk', 'nd', 'dn']);
	});

	it('by source: XPLAN, Outlook, Google, with colours', () => {
		const g = groupTodos(tasks, 'source', 'title', TODAY);
		expect(g.map((x) => x.key)).toEqual(['source:xplan', 'source:m365', 'source:google']);
		expect(g[0].color).toBe('#7c3aed');
		expect(ids(g[1].tasks)).toEqual(['td', 'dn']);
	});

	it('returns nothing for no tasks', () => {
		expect(groupTodos([], 'due', 'due', TODAY)).toEqual([]);
		expect(groupTodos([], 'client', 'due', TODAY)).toEqual([]);
	});
});

describe('todoCounts', () => {
	it('counts open tasks by bucket; undated is in no quick bucket', () => {
		const c = todoCounts(
			[
				task({ dueAt: '2026-10-01', status: 'overdue' }),
				task({ dueAt: '2026-10-13' }),
				task({ dueAt: '2026-10-14' }),
				task({ dueAt: '2026-10-15' }),
				task({ dueAt: '2027-02-01' }),
				task({}),
				task({ dueAt: '2026-10-14', status: 'done' })
			],
			TODAY
		);
		expect(c).toEqual({ overdue: 2, today: 1, upcoming: 2, open: 6, done: 1 });
	});
});

describe('gating', () => {
	it('explains why a task cannot be completed', () => {
		expect(completeBlock(task({ writable: true }), false, null)).toBeNull();
		expect(completeBlock(task({ writable: true, status: 'done' }), false, null)).toBe(
			'Already done'
		);
		expect(completeBlock(task({ id: 'x', writable: true }), false, 'x')).toBe('Working…');
		expect(completeBlock(task({ writable: false }), false, null)).toMatch(/read-only/i);
		expect(completeBlock(task({ source: 'xplan', writable: true }), true, null)).toBe(
			'XPLAN access is locked'
		);
		expect(completeBlock(task({ source: 'm365', writable: true }), true, null)).toBeNull();
	});

	it('blocks opening only XPLAN while locked', () => {
		expect(openBlocked(task({ source: 'xplan' }), true)).toBe(true);
		expect(openBlocked(task({ source: 'xplan' }), false)).toBe(false);
		expect(openBlocked(task({ source: 'google' }), true)).toBe(false);
	});
});

describe('stepFocus', () => {
	const rows = ['a', 'b', 'c'];
	it('moves and clamps', () => {
		expect(stepFocus(rows, 'a', 1)).toBe('b');
		expect(stepFocus(rows, 'c', 1)).toBe('c');
		expect(stepFocus(rows, 'a', -1)).toBe('a');
	});
	it('starts at an end when nothing (or a vanished row) is focused', () => {
		expect(stepFocus(rows, null, 1)).toBe('a');
		expect(stepFocus(rows, 'gone', -1)).toBe('c');
		expect(stepFocus([], null, 1)).toBeNull();
	});
});

describe('parsePrefs', () => {
	it('falls back to defaults for nothing or junk', () => {
		expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
		expect(parsePrefs('{not json')).toEqual(DEFAULT_PREFS);
		expect(parsePrefs('null')).toEqual(DEFAULT_PREFS);
		expect(parsePrefs('{"groupBy":"colour","sort":7,"showCompleted":"yes"}')).toEqual(
			DEFAULT_PREFS
		);
	});
	it('keeps valid values and only true collapsed flags', () => {
		expect(
			parsePrefs(
				JSON.stringify({
					groupBy: 'client',
					sort: 'title',
					showCompleted: true,
					collapsed: { 'due:later': true, 'due:today': false, x: 'y' }
				})
			)
		).toEqual({
			groupBy: 'client',
			sort: 'title',
			showCompleted: true,
			collapsed: { 'due:later': true }
		});
	});
});
