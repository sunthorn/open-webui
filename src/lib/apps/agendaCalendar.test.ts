import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AgendaEvent } from '$lib/apis/gateway/agenda';
import {
	addDays,
	daysBetween,
	dayList,
	minuteOfDay,
	monthGrid,
	viewRange,
	stepAnchor,
	rangeLabel,
	viewTitle,
	chunkRange,
	rangeInside,
	mergeEvents,
	isSpanning,
	eventDays,
	coversDay,
	dayEvents,
	layoutDay,
	layoutSpanning,
	blockGeometry,
	snap,
	minutesAt,
	dropStart,
	movedTimes,
	resizedTimes,
	timesChanged,
	minLabel
} from './agendaCalendar';

// The planners are in Sydney: pin the zone so the DST cases mean something
// (AEST → AEDT at 02:00 on Sun 4 Oct 2026; the day is 23 hours long).
// vitest runs each file in its own fork, and the zone is put back after.
let savedTz: string | undefined;
beforeAll(() => {
	savedTz = process.env.TZ;
	process.env.TZ = 'Australia/Sydney';
});
afterAll(() => {
	if (savedTz === undefined) delete process.env.TZ;
	else process.env.TZ = savedTz;
});

const ev = (over: Partial<AgendaEvent>): AgendaEvent => ({
	id: over.id ?? 'm365:e',
	source: 'm365',
	sourceId: 'e',
	title: over.id ?? 'e',
	startAt: '2026-10-13T09:00:00',
	endAt: '2026-10-13T10:00:00',
	allDay: false,
	attendees: [],
	href: 'h',
	writable: true,
	...over
});
// Local wall time → ISO with offset (what the gateway sends).
const at = (day: string, h: number, m = 0) => {
	const [y, mo, d] = day.split('-').map(Number);
	return new Date(y, mo - 1, d, h, m).toISOString();
};
const timed = (id: string, day: string, h1: number, m1: number, h2: number, m2: number) =>
	ev({ id, startAt: at(day, h1, m1), endAt: at(day, h2, m2) });

describe('zone under test', () => {
	it('is Sydney, with the October DST jump', () => {
		expect(new Date(2026, 9, 3, 12).getTimezoneOffset()).toBe(-600);
		expect(new Date(2026, 9, 5, 12).getTimezoneOffset()).toBe(-660);
	});
});

describe('days', () => {
	it('adds days across month, year and DST boundaries', () => {
		expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addDays('2026-10-03', 1)).toBe('2026-10-04');
		expect(addDays('2026-10-04', 1)).toBe('2026-10-05');
		expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
		expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
	});
	it('counts whole days across a 23-hour day', () => {
		expect(daysBetween('2026-10-01', '2026-10-08')).toBe(7);
		expect(daysBetween('2026-10-08', '2026-10-01')).toBe(-7);
		expect(dayList('2026-10-03', '2026-10-05')).toEqual(['2026-10-03', '2026-10-04', '2026-10-05']);
	});
	it('minuteOfDay is wall-clock, so the DST day still lines up with its hour labels', () => {
		expect(minuteOfDay(at('2026-10-13', 9, 30), '2026-10-13')).toBe(570);
		expect(minuteOfDay(at('2026-10-04', 9), '2026-10-04')).toBe(540);
		expect(minuteOfDay(at('2026-10-04', 1, 30), '2026-10-04')).toBe(90);
		expect(minuteOfDay(at('2026-10-03', 22), '2026-10-04')).toBe(-120);
		expect(minuteOfDay(at('2026-10-05', 1), '2026-10-04')).toBe(1500);
	});
});

describe('monthGrid', () => {
	it('is 42 days from the Sunday on or before the 1st', () => {
		const g = monthGrid('2026-10-13');
		expect(g).toHaveLength(42);
		expect(g[0]).toEqual({ day: '2026-09-27', inMonth: false });
		expect(g[4]).toEqual({ day: '2026-10-01', inMonth: true });
		expect(g[41]).toEqual({ day: '2026-11-07', inMonth: false });
		expect(g.filter((c) => c.inMonth)).toHaveLength(31);
	});
	it('every cell is the day after the one before, across the DST day', () => {
		const g = monthGrid('2026-10-01');
		for (let i = 1; i < g.length; i++) expect(g[i].day).toBe(addDays(g[i - 1].day, 1));
		expect(g.map((c) => c.day)).toContain('2026-10-04');
		expect(new Set(g.map((c) => c.day)).size).toBe(42);
	});
	it('starts on the 1st itself when the 1st is a Sunday', () => {
		const g = monthGrid('2026-11-20');
		expect(g[0]).toEqual({ day: '2026-11-01', inMonth: true });
	});
	it('handles February and the turn of the year', () => {
		const feb = monthGrid('2027-02-10');
		expect(feb[0].day).toBe('2027-01-31');
		expect(feb.filter((c) => c.inMonth)).toHaveLength(28);
		const dec = monthGrid('2026-12-05');
		expect(dec[41].day).toBe('2027-01-09');
	});
});

describe('viewRange', () => {
	const A = '2026-10-14'; // a Wednesday
	it('day', () => {
		expect(viewRange('day', A)).toEqual({ from: A, to: A, days: [A] });
	});
	it('week is Sunday to Saturday', () => {
		const r = viewRange('week', A);
		expect([r.from, r.to, r.days.length]).toEqual(['2026-10-11', '2026-10-17', 7]);
	});
	it('work week is Monday to Friday', () => {
		const r = viewRange('workweek', A);
		expect(r.days).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
		// a Sunday anchor belongs to the week it starts
		expect(viewRange('workweek', '2026-10-11').from).toBe('2026-10-12');
		// a Saturday anchor still shows its own Mon–Fri
		expect(viewRange('workweek', '2026-10-17').from).toBe('2026-10-12');
	});
	it('month covers the 6-week grid', () => {
		const r = viewRange('month', A);
		expect([r.from, r.to, r.days.length]).toEqual(['2026-09-27', '2026-11-07', 42]);
	});
	it('agenda lists 14 days from the anchor', () => {
		const r = viewRange('agenda', A);
		expect([r.from, r.to, r.days.length]).toEqual([A, '2026-10-27', 14]);
	});
	it('week across the DST day still has 7 distinct days', () => {
		expect(viewRange('week', '2026-10-04').days).toEqual(dayList('2026-10-04', '2026-10-10'));
	});
});

describe('stepAnchor and titles', () => {
	it('steps per view', () => {
		expect(stepAnchor('day', '2026-10-31', 1)).toBe('2026-11-01');
		expect(stepAnchor('week', '2026-10-14', -1)).toBe('2026-10-07');
		expect(stepAnchor('workweek', '2026-10-14', 1)).toBe('2026-10-21');
		expect(stepAnchor('month', '2026-01-31', 1)).toBe('2026-02-01');
		expect(stepAnchor('month', '2026-01-15', -1)).toBe('2025-12-01');
		expect(stepAnchor('agenda', '2026-10-14', 1)).toBe('2026-10-28');
	});
	it('labels ranges like the week label does', () => {
		expect(rangeLabel('2026-10-11', '2026-10-17')).toBe('11 – 17 Oct 2026');
		expect(rangeLabel('2026-09-27', '2026-10-03')).toBe('27 Sep – 3 Oct 2026');
		expect(rangeLabel('2026-12-27', '2027-01-02')).toBe('27 Dec 2026 – 2 Jan 2027');
		expect(rangeLabel('2026-10-13', '2026-10-13')).toBe('13 Oct 2026');
	});
	it('titles each view', () => {
		expect(viewTitle('day', '2026-10-13')).toBe('Tue 13 Oct 2026');
		expect(viewTitle('week', '2026-10-13')).toBe('11 – 17 Oct 2026');
		expect(viewTitle('workweek', '2026-10-13')).toBe('12 – 16 Oct 2026');
		expect(viewTitle('month', '2026-10-13')).toBe('October 2026');
		expect(viewTitle('agenda', '2026-10-13')).toBe('13 – 26 Oct 2026');
	});
});

describe('fetch ranges', () => {
	it('splits ranges longer than 31 days', () => {
		expect(chunkRange('2026-10-01', '2026-10-31')).toEqual([
			{ from: '2026-10-01', to: '2026-10-31' }
		]);
		expect(chunkRange('2026-09-27', '2026-11-07')).toEqual([
			{ from: '2026-09-27', to: '2026-10-27' },
			{ from: '2026-10-28', to: '2026-11-07' }
		]);
		expect(chunkRange('2026-10-13', '2026-10-13')).toEqual([
			{ from: '2026-10-13', to: '2026-10-13' }
		]);
	});
	it('knows when a range sits inside the page window', () => {
		expect(rangeInside('2026-10-13', '2026-10-20', '2026-10-13', '2026-10-20')).toBe(true);
		expect(rangeInside('2026-10-11', '2026-10-17', '2026-10-13', '2026-10-20')).toBe(false);
	});
	it('merges answers without duplicates', () => {
		const a = ev({ id: 'a' });
		const b = ev({ id: 'b' });
		expect(mergeEvents([[a, b], [b]]).map((e) => e.id)).toEqual(['a', 'b']);
	});
});

describe('which row', () => {
	it('all-day and 24 h+ timed events span; shorter timed events do not', () => {
		expect(isSpanning(ev({ allDay: true, startAt: '2026-10-13', endAt: '2026-10-13' }))).toBe(true);
		expect(isSpanning(ev({ startAt: at('2026-10-13', 9), endAt: at('2026-10-14', 9) }))).toBe(true);
		expect(isSpanning(timed('x', '2026-10-13', 9, 0, 17, 0))).toBe(false);
	});
	it('all-day endAt is inclusive; a timed end at midnight stays on its day', () => {
		expect(eventDays(ev({ allDay: true, startAt: '2026-10-13', endAt: '2026-10-15' }))).toEqual({
			first: '2026-10-13',
			last: '2026-10-15'
		});
		expect(eventDays(ev({ startAt: at('2026-10-13', 22), endAt: at('2026-10-14', 0) }))).toEqual({
			first: '2026-10-13',
			last: '2026-10-13'
		});
		expect(
			coversDay(ev({ startAt: at('2026-10-13', 22), endAt: at('2026-10-14', 1) }), '2026-10-14')
		).toBe(true);
	});
	it('dayEvents puts spanning first, then timed by start', () => {
		const a = timed('late', '2026-10-13', 15, 0, 16, 0);
		const b = timed('early', '2026-10-13', 8, 0, 9, 0);
		const c = ev({ id: 'leave', allDay: true, startAt: '2026-10-12', endAt: '2026-10-14' });
		const d = timed('other-day', '2026-10-14', 8, 0, 9, 0);
		const r = dayEvents([a, b, c, d], '2026-10-13');
		expect(r.spanning.map((e) => e.id)).toEqual(['leave']);
		expect(r.timed.map((e) => e.id)).toEqual(['early', 'late']);
	});
	it('an event carried over from last night sorts first', () => {
		const overnight = ev({
			id: 'night',
			startAt: at('2026-10-12', 22),
			endAt: at('2026-10-13', 0, 30)
		});
		const early = timed('early', '2026-10-13', 0, 15, 1, 0);
		expect(dayEvents([early, overnight], '2026-10-13').timed.map((e) => e.id)).toEqual([
			'night',
			'early'
		]);
	});
});

describe('layoutDay', () => {
	const D = '2026-10-13';
	const cols = (bs: ReturnType<typeof layoutDay>) =>
		Object.fromEntries(bs.map((b) => [b.event.id, [b.col, b.cols, b.span]]));

	it('a lone event takes the full width', () => {
		const [b] = layoutDay([timed('a', D, 9, 0, 10, 0)], D);
		expect([b.startMin, b.endMin, b.col, b.cols, b.span]).toEqual([540, 600, 0, 1, 1]);
	});
	it('two overlapping events sit side by side', () => {
		const r = layoutDay([timed('a', D, 9, 0, 10, 0), timed('b', D, 9, 30, 10, 30)], D);
		expect(cols(r)).toEqual({ a: [0, 2, 1], b: [1, 2, 1] });
	});
	it('back-to-back events do not overlap', () => {
		const r = layoutDay([timed('a', D, 9, 0, 10, 0), timed('b', D, 10, 0, 11, 0)], D);
		expect(cols(r)).toEqual({ a: [0, 1, 1], b: [0, 1, 1] });
	});
	it('reuses a freed column inside a cluster, and a free column lets a block stretch', () => {
		// a 9–12, b 9–10, e 9:30–10:30 → three columns; c 10:30–11:30 reuses b's
		// column and, with e gone by then, stretches over e's too.
		const r = layoutDay(
			[
				timed('a', D, 9, 0, 12, 0),
				timed('b', D, 9, 0, 10, 0),
				timed('c', D, 10, 30, 11, 30),
				timed('e', D, 9, 30, 10, 30)
			],
			D
		);
		expect(cols(r)).toEqual({ a: [0, 3, 1], b: [1, 3, 1], e: [2, 3, 1], c: [1, 3, 2] });
	});
	it('separate clusters are laid out independently', () => {
		const r = layoutDay(
			[timed('a', D, 9, 0, 10, 0), timed('b', D, 9, 0, 10, 0), timed('c', D, 14, 0, 15, 0)],
			D
		);
		expect(cols(r).c).toEqual([0, 1, 1]);
		expect(cols(r).a[1]).toBe(2);
	});
	it('short events overlap by their drawn height', () => {
		// 9:00–9:05 is drawn 20 min tall, so 9:10 can't share its column
		const r = layoutDay([timed('a', D, 9, 0, 9, 5), timed('b', D, 9, 10, 9, 40)], D);
		expect(cols(r)).toEqual({ a: [0, 2, 1], b: [1, 2, 1] });
		const r2 = layoutDay([timed('a', D, 9, 0, 9, 5), timed('b', D, 9, 10, 9, 40)], D, 5);
		expect(cols(r2)).toEqual({ a: [0, 1, 1], b: [0, 1, 1] });
	});
	it('clips an overnight event to each day and flags the cut', () => {
		const e = ev({ id: 'n', startAt: at('2026-10-13', 22), endAt: at('2026-10-14', 2) });
		const [d1] = layoutDay([e], '2026-10-13');
		const [d2] = layoutDay([e], '2026-10-14');
		expect([d1.startMin, d1.endMin, d1.continuesBefore, d1.continuesAfter]).toEqual([
			1320,
			1440,
			false,
			true
		]);
		expect([d2.startMin, d2.endMin, d2.continuesBefore, d2.continuesAfter]).toEqual([
			0,
			120,
			true,
			false
		]);
	});
	it('ignores all-day and other-day events', () => {
		expect(
			layoutDay(
				[ev({ allDay: true, startAt: D, endAt: D }), timed('x', '2026-10-14', 9, 0, 10, 0)],
				D
			)
		).toEqual([]);
	});
	it('places events on the 23-hour DST day by wall-clock time', () => {
		const [b] = layoutDay([timed('a', '2026-10-04', 9, 0, 10, 0)], '2026-10-04');
		expect([b.startMin, b.endMin]).toEqual([540, 600]);
	});
});

describe('blockGeometry', () => {
	it('a lone block fills the column', () => {
		expect(blockGeometry({ col: 0, cols: 1, span: 1 })).toEqual({ left: 0, width: 100 });
	});
	it('earlier columns overlap into the next; the last keeps its share', () => {
		const a = blockGeometry({ col: 0, cols: 2, span: 1 });
		expect(a.left).toBe(0);
		expect(a.width).toBeCloseTo(85, 5);
		expect(blockGeometry({ col: 1, cols: 2, span: 1 })).toEqual({ left: 50, width: 50 });
	});
	it('never runs past the column edge', () => {
		const g = blockGeometry({ col: 1, cols: 3, span: 1 });
		expect(g.left + g.width).toBeLessThanOrEqual(100);
		expect(blockGeometry({ col: 0, cols: 3, span: 3 })).toEqual({ left: 0, width: 100 });
	});
});

describe('layoutSpanning', () => {
	const week = dayList('2026-10-11', '2026-10-17');
	const ad = (id: string, s: string, e: string) => ev({ id, allDay: true, startAt: s, endAt: e });
	it('a multi-day event spans its columns', () => {
		const [b] = layoutSpanning([ad('a', '2026-10-13', '2026-10-15')], week);
		expect([b.startCol, b.span, b.lane, b.continuesBefore, b.continuesAfter]).toEqual([
			2,
			3,
			0,
			false,
			false
		]);
	});
	it('clips to the visible days and flags it', () => {
		const [b] = layoutSpanning([ad('a', '2026-10-09', '2026-10-20')], week);
		expect([b.startCol, b.span, b.continuesBefore, b.continuesAfter]).toEqual([0, 7, true, true]);
	});
	it('stacks overlapping spans in lanes and reuses a lane once free', () => {
		const r = layoutSpanning(
			[
				ad('a', '2026-10-12', '2026-10-14'),
				ad('b', '2026-10-13', '2026-10-13'),
				ad('c', '2026-10-15', '2026-10-16')
			],
			week
		);
		expect(Object.fromEntries(r.map((b) => [b.event.id, b.lane]))).toEqual({ a: 0, b: 1, c: 0 });
	});
	it('longer spans claim the top lane when they start the same day', () => {
		const r = layoutSpanning(
			[ad('short', '2026-10-12', '2026-10-12'), ad('long', '2026-10-12', '2026-10-16')],
			week
		);
		expect(r.map((b) => [b.event.id, b.lane])).toEqual([
			['long', 0],
			['short', 1]
		]);
	});
	it('includes 24 h+ timed events and skips out-of-range ones', () => {
		const r = layoutSpanning(
			[
				ev({ id: 'conf', startAt: at('2026-10-12', 9), endAt: at('2026-10-14', 17) }),
				ad('gone', '2026-10-01', '2026-10-02'),
				timed('meeting', '2026-10-13', 9, 0, 10, 0)
			],
			week
		);
		expect(r.map((b) => [b.event.id, b.startCol, b.span])).toEqual([['conf', 1, 3]]);
	});
	it('spans the DST day like any other', () => {
		const [b] = layoutSpanning(
			[ad('a', '2026-10-03', '2026-10-05')],
			dayList('2026-10-04', '2026-10-10')
		);
		expect([b.startCol, b.span, b.continuesBefore]).toEqual([0, 2, true]);
	});
});

describe('drag maths', () => {
	it('snaps to 15 minutes', () => {
		expect(snap(7)).toBe(0);
		expect(snap(8)).toBe(15);
		expect(snap(552)).toBe(555);
		expect(minutesAt(96, 48)).toBe(120);
	});
	it('drop start keeps the grab point and stays inside the day', () => {
		expect(dropStart(600, 20)).toBe(585);
		expect(dropStart(5, 30)).toBe(0);
		expect(dropStart(1500, 0)).toBe(1425);
	});
	it('a move keeps the duration', () => {
		const e = timed('a', '2026-10-13', 9, 0, 10, 30);
		const t = movedTimes(e, '2026-10-15', 14 * 60);
		expect(new Date(t.startAt).getTime()).toBe(new Date(2026, 9, 15, 14, 0).getTime());
		expect(Date.parse(t.endAt) - Date.parse(t.startAt)).toBe(90 * 60_000);
		expect(t.startAt.endsWith('+00:00')).toBe(true);
	});
	it('a move onto the DST day lands on the wall-clock time', () => {
		const e = timed('a', '2026-10-03', 9, 0, 10, 0);
		const t = movedTimes(e, '2026-10-04', 9 * 60);
		expect(new Date(t.startAt).getHours()).toBe(9);
		expect(new Date(t.startAt).getTimezoneOffset()).toBe(-660);
		expect(Date.parse(t.endAt) - Date.parse(t.startAt)).toBe(60 * 60_000);
	});
	it('a resize moves only the end, snapped, at least 15 min long', () => {
		const e = timed('a', '2026-10-13', 9, 0, 10, 0);
		const t = resizedTimes(e, 11 * 60 + 8);
		expect(t.startAt).toBe(new Date(e.startAt).toISOString().replace('Z', '+00:00'));
		expect(new Date(t.endAt).getTime()).toBe(new Date(2026, 9, 13, 11, 15).getTime());
		const tiny = resizedTimes(e, 9 * 60 + 2);
		expect(new Date(tiny.endAt).getTime()).toBe(new Date(2026, 9, 13, 9, 15).getTime());
	});
	it('knows a no-op drop', () => {
		const e = timed('a', '2026-10-13', 9, 0, 10, 0);
		expect(timesChanged(e, movedTimes(e, '2026-10-13', 540))).toBe(false);
		expect(timesChanged(e, movedTimes(e, '2026-10-13', 555))).toBe(true);
	});
	it('labels minutes', () => {
		expect(minLabel(555)).toBe('09:15');
		expect(minLabel(1440)).toBe('00:00');
	});
});
