import { describe, it, expect } from 'vitest';
import {
	groupTasks, timelineRange, placeEvent, eventsOn, allDayOn, toCalendarEvents,
	sourceCalendars, fallbackAttention, localDay, SOURCE_META
} from './agenda';
import type { AgendaEvent, AgendaTask } from '$lib/apis/gateway/agenda';

const task = (over: Partial<AgendaTask>): AgendaTask => ({
	id: 'google:l~x', source: 'google', sourceId: 'l~x', title: 't', status: 'open',
	href: 'h', writable: false, ...over
});
const event = (over: Partial<AgendaEvent>): AgendaEvent => ({
	id: 'm365:e', source: 'm365', sourceId: 'e', title: 'e', startAt: '2026-09-14T09:00:00+00:00',
	endAt: '2026-09-14T10:00:00+00:00', allDay: false, attendees: [], href: 'h', writable: false, ...over
});
// Build ISO strings in LOCAL time so the tests hold in any zone.
const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const TODAY = '2026-09-14';

describe('groupTasks', () => {
	it('puts overdue first, clients A–Z, unassigned last; earliest due first inside', () => {
		const tasks = [
			task({ id: '1', title: 'z', dueAt: '2026-09-20', client: { id: 'b', name: 'Bragg, M', via: 'rule' } }),
			task({ id: '2', title: 'a', dueAt: '2026-09-15', client: { id: 'b', name: 'Bragg, M', via: 'rule' } }),
			task({ id: '3', title: 'late', dueAt: '2026-09-01', status: 'overdue', client: { id: 'a', name: 'Adams, J', via: 'pin' } }),
			task({ id: '4', title: 'loose' }),
			task({ id: '5', title: 'undated adams', client: { id: 'a', name: 'Adams, J', via: 'pin' } })
		];
		const g = groupTasks(tasks, TODAY);
		expect(g.map((x) => [x.kind, x.label])).toEqual([
			['overdue', 'Overdue'], ['client', 'Adams, J'], ['client', 'Bragg, M'], ['unassigned', 'Unassigned']
		]);
		expect(g[0].tasks.map((t) => t.id)).toEqual(['3']);
		expect(g[1].tasks.map((t) => t.id)).toEqual(['5']);          // overdue one is NOT repeated
		expect(g[2].tasks.map((t) => t.id)).toEqual(['2', '1']);
		expect(g[3].tasks.map((t) => t.id)).toEqual(['4']);
	});

	it('omits empty groups', () => {
		expect(groupTasks([task({ id: '1' })], TODAY).map((g) => g.kind)).toEqual(['unassigned']);
	});
});

describe('timeline', () => {
	it('defaults to 7–19 and stretches to cover early or late events', () => {
		expect(timelineRange([], TODAY)).toEqual({ startHour: 7, endHour: 19 });
		const early = event({ startAt: local(2026, 9, 14, 6), endAt: local(2026, 9, 14, 7) });
		const late = event({ startAt: local(2026, 9, 14, 18, 30), endAt: local(2026, 9, 14, 20, 15) });
		expect(timelineRange([early, late], TODAY)).toEqual({ startHour: 6, endHour: 21 });
	});

	it('places a 9–10 event on a 7–19 timeline', () => {
		const e = event({ startAt: local(2026, 9, 14, 9), endAt: local(2026, 9, 14, 10) });
		const p = placeEvent(e, { startHour: 7, endHour: 19 }, TODAY)!;
		expect(p.top).toBeCloseTo((2 / 12) * 100, 5);
		expect(p.height).toBeCloseTo((1 / 12) * 100, 5);
	});

	it('all-day and other-day events are not placed, but are listed separately', () => {
		const ad = event({ id: 'ad', allDay: true, startAt: '2026-09-14', endAt: '2026-09-14' });
		const other = event({ id: 'o', startAt: local(2026, 9, 15, 9), endAt: local(2026, 9, 15, 10) });
		const timed = event({ id: 't', startAt: local(2026, 9, 14, 9), endAt: local(2026, 9, 14, 10) });
		expect(placeEvent(ad, { startHour: 7, endHour: 19 }, TODAY)).toBeNull();
		expect(placeEvent(other, { startHour: 7, endHour: 19 }, TODAY)).toBeNull();
		expect(eventsOn([ad, other, timed], TODAY).map((e) => e.id)).toEqual(['t']);
		expect(allDayOn([ad, other, timed], TODAY).map((e) => e.id)).toEqual(['ad']);
	});

	it('enforces a minimum height for tiny events', () => {
		const e = event({ startAt: local(2026, 9, 14, 9), endAt: local(2026, 9, 14, 9, 5) });
		expect(placeEvent(e, { startHour: 7, endHour: 19 }, TODAY)!.height).toBe(3);
	});

	it('sorts events chronologically even when sources use different ISO offset formats', () => {
		// XPLAN emits a naive local ISO string (no offset); m365/google emit an explicit
		// UTC offset. Pin TZ so the cross-midnight relationship between the two is
		// deterministic regardless of the machine running the suite: in Australia/Sydney
		// (UTC+10), "2026-09-16T01:00:00" local is 2026-09-15T15:00 UTC, one hour BEFORE
		// "2026-09-15T16:00:00+00:00" — even though its string sorts LATER
		// ("...09-16..." > "...09-15..."), so a naive string sort gets the order backwards.
		const originalTz = process.env.TZ;
		process.env.TZ = 'Australia/Sydney';
		try {
			const naive = event({ id: 'naive-1am', startAt: '2026-09-16T01:00:00', endAt: '2026-09-16T01:30:00' });
			const utcOffset = event({
				id: 'utc-offset-later',
				startAt: '2026-09-15T16:00:00+00:00',
				endAt: '2026-09-15T16:30:00+00:00'
			});
			expect(Date.parse(naive.startAt)).toBeLessThan(Date.parse(utcOffset.startAt));
			const sorted = eventsOn([utcOffset, naive], localDay(naive.startAt));
			expect(sorted.map((e) => e.id)).toEqual(['naive-1am', 'utc-offset-later']);
		} finally {
			if (originalTz === undefined) {
				delete process.env.TZ;
			} else {
				process.env.TZ = originalTz;
			}
		}
	});
});

describe('week view mapping', () => {
	it('maps to CalendarEventModel with nanosecond times and the source as calendar', () => {
		const e = event({ startAt: '2026-09-14T09:00:00+00:00', endAt: '2026-09-14T10:00:00+00:00', location: 'Zoom' });
		const [m] = toCalendarEvents([e]);
		expect(m.id).toBe('m365:e');
		expect(m.calendar_id).toBe('m365');
		expect(m.start_at).toBe(Date.parse('2026-09-14T09:00:00+00:00') * 1_000_000);
		expect(m.end_at).toBe(Date.parse('2026-09-14T10:00:00+00:00') * 1_000_000);
		expect(m.location).toBe('Zoom');
		expect(m.color).toBe(SOURCE_META.m365.color);
	});

	it('all-day events span local midnight to midnight', () => {
		const [m] = toCalendarEvents([event({ allDay: true, startAt: '2026-09-14', endAt: '2026-09-14' })]);
		expect(m.all_day).toBe(true);
		expect(m.start_at).toBe(new Date(2026, 8, 14).getTime() * 1_000_000);
	});

	it('one pseudo-calendar per source', () => {
		expect(sourceCalendars().map((c) => c.id)).toEqual(['xplan', 'm365', 'google']);
	});
});

describe('fallbackAttention', () => {
	it('overdue first, then due today, capped at six', () => {
		const tasks = [
			task({ id: 'today', dueAt: TODAY }),
			task({ id: 'late', dueAt: '2026-09-01', status: 'overdue' }),
			task({ id: 'future', dueAt: '2026-09-30' }),
			...Array.from({ length: 8 }, (_, i) => task({ id: `l${i}`, dueAt: '2026-09-02', status: 'overdue' }))
		];
		const out = fallbackAttention(tasks, TODAY);
		expect(out).toHaveLength(6);
		expect(out.every((t) => t.status === 'overdue')).toBe(true);
		expect(fallbackAttention(tasks.slice(0, 3), TODAY).map((t) => t.id)).toEqual(['late', 'today']);
	});
});

describe('localDay', () => {
	it('uses the browser zone', () => {
		expect(localDay(local(2026, 9, 14, 23, 30))).toBe('2026-09-14');
		expect(localDay('2026-09-14')).toBe('2026-09-14');
	});
});
