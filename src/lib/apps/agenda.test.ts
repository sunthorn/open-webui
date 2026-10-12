import { describe, it, expect } from 'vitest';
import {
	allDayOn, toCalendarEvents,
	sourceCalendars, fallbackAttention, localDay, SOURCE_META, snoozeUntil, describeChange, applyChange, toLocalInput, moveWindow, clientLabel, sourceChip, sourceChips,
	weekStartOf, shiftWeek, weekWindow, weekLabel, weekScrollHour, narrativePoints
} from './agenda';
import type { AgendaEvent, AgendaTask, AgendaResponse } from '$lib/apis/gateway/agenda';

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

describe('allDayOn', () => {
	it('lists only all-day events covering the day', () => {
		const ad = event({ id: 'ad', allDay: true, startAt: '2026-09-13', endAt: '2026-09-14' });
		const other = event({ id: 'o', allDay: true, startAt: '2026-09-15', endAt: '2026-09-15' });
		const timed = event({ id: 't', startAt: local(2026, 9, 14, 9), endAt: local(2026, 9, 14, 10) });
		expect(allDayOn([ad, other, timed], TODAY).map((e) => e.id)).toEqual(['ad']);
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
	it('counts overdue (listed below already) and lists due today, capped at six', () => {
		const tasks = [
			task({ id: 'today', dueAt: TODAY }),
			task({ id: 'late', dueAt: '2026-09-01', status: 'overdue' }),
			task({ id: 'future', dueAt: '2026-09-30' }),
			...Array.from({ length: 8 }, (_, i) => task({ id: `t${i}`, dueAt: TODAY })),
			...Array.from({ length: 3 }, (_, i) => task({ id: `l${i}`, dueAt: '2026-09-02', status: 'overdue' }))
		];
		const out = fallbackAttention(tasks, TODAY);
		expect(out.overdue).toBe(4);
		expect(out.dueToday).toHaveLength(6);
		expect(out.dueToday.every((t) => t.status !== 'overdue')).toBe(true);
		expect(fallbackAttention(tasks.slice(0, 3), TODAY)).toEqual({ overdue: 1, dueToday: [tasks[0]] });
	});
});

describe('localDay', () => {
	it('uses the browser zone', () => {
		expect(localDay(local(2026, 9, 14, 23, 30))).toBe('2026-09-14');
		expect(localDay('2026-09-14')).toBe('2026-09-14');
	});
});

const agendaOf = (tasks: AgendaTask[], events: AgendaEvent[] = []): AgendaResponse => ({
	from: TODAY, to: '2026-09-21', compiledAt: 'x', tasks, events,
	sources: { xplan: { status: 'ok' }, m365: { status: 'ok' }, google: { status: 'ok' } }
});

describe('snoozeUntil', () => {
	it('adds a day or a week in calendar terms', () => {
		expect(snoozeUntil('2026-09-14', 'tomorrow')).toBe('2026-09-15');
		expect(snoozeUntil('2026-09-14', 'nextWeek')).toBe('2026-09-21');
		expect(snoozeUntil('2026-09-30', 'tomorrow')).toBe('2026-10-01');
		expect(snoozeUntil('2026-12-28', 'nextWeek')).toBe('2027-01-04');
	});
});

describe('describeChange', () => {
	it('names the item, the source and the exact change', () => {
		const t = task({ title: 'Send SOA', source: 'google' });
		expect(describeChange({ kind: 'complete', task: t })).toBe('Mark "Send SOA" as done in Google?');
		expect(describeChange({ kind: 'snooze', task: t, until: '2026-09-21' })).toContain('2026-09-21');
		const e = event({ title: 'Review', source: 'm365' });
		const s = describeChange({ kind: 'move', event: e, startAt: local(2026, 9, 21, 9), endAt: local(2026, 9, 21, 10) });
		expect(s).toContain('"Review"'); expect(s).toContain('Outlook');
		expect(describeChange({ kind: 'pin', item: t, clientId: '1', clientName: 'Smith, Jo' })).toBe('Assign "Send SOA" to Smith, Jo?');
		expect(describeChange({ kind: 'reject', task: t, clientId: '1', clientName: 'Smith, Jo' })).toContain('Smith, Jo');
		expect(describeChange({ kind: 'unpin', item: t })).toContain('Send SOA');
	});
});

describe('applyChange', () => {
	const t1 = task({ id: 'google:l~1', sourceId: 'l~1', title: 'a', dueAt: '2026-09-14', suggestion: { clientId: '9', name: 'X', confidence: 0.7 } });
	const t2 = task({ id: 'google:l~2', sourceId: 'l~2', title: 'b', status: 'overdue', dueAt: '2026-09-01', client: { id: '5', name: 'Lee', via: 'pin' } });
	const e1 = event({ id: 'm365:e', client: { id: '5', name: 'Lee', via: 'rule' } });
	const base = agendaOf([t1, t2], [e1]);

	it('complete removes the task', () => {
		const out = applyChange(base, { kind: 'complete', task: t1 });
		expect(out.tasks.map((t) => t.id)).toEqual(['google:l~2']);
		expect(base.tasks).toHaveLength(2); // input untouched
	});

	it('snooze moves the due date and clears overdue', () => {
		const out = applyChange(base, { kind: 'snooze', task: t2, until: '2026-09-21' });
		expect(out.tasks[1]).toMatchObject({ dueAt: '2026-09-21', status: 'open' });
		expect(base.tasks[1].status).toBe('overdue');
	});

	it('move rewrites the window', () => {
		const out = applyChange(base, { kind: 'move', event: e1, startAt: 'S', endAt: 'E' });
		expect(out.events[0]).toMatchObject({ startAt: 'S', endAt: 'E' });
	});

	it('pin sets a planner client and drops the suggestion; reject drops only the suggestion; unpin clears the client', () => {
		const pinned = applyChange(base, { kind: 'pin', item: t1, clientId: '7', clientName: 'Nguyen' });
		expect(pinned.tasks[0].client).toEqual({ id: '7', name: 'Nguyen', via: 'pin' });
		expect(pinned.tasks[0].suggestion).toBeUndefined();
		const rejected = applyChange(base, { kind: 'reject', task: t1, clientId: '9', clientName: 'X' });
		expect(rejected.tasks[0].suggestion).toBeUndefined();
		expect(rejected.tasks[0].client).toBeUndefined();
		const cleared = applyChange(base, { kind: 'unpin', item: e1 });
		expect(cleared.events[0].client).toBeUndefined();
	});

	it('pin works on an event and unpin on a task; reject keeps an existing client', () => {
		const pinnedEvent = applyChange(base, { kind: 'pin', item: e1, clientId: '7', clientName: 'Nguyen' });
		expect(pinnedEvent.events[0].client).toEqual({ id: '7', name: 'Nguyen', via: 'pin' });
		expect(base.events[0].client).toEqual({ id: '5', name: 'Lee', via: 'rule' }); // input untouched
		const unpinnedTask = applyChange(base, { kind: 'unpin', item: t2 });
		expect(unpinnedTask.tasks[1].client).toBeUndefined();
		expect(unpinnedTask.tasks[1].title).toBe('b');
		const withBoth = task({ id: 'google:l~9', sourceId: 'l~9', title: 'both', client: { id: '5', name: 'Lee', via: 'rule' }, suggestion: { clientId: '9', name: 'X', confidence: 0.7 } });
		const rejected = applyChange(agendaOf([withBoth]), { kind: 'reject', task: withBoth, clientId: '9', clientName: 'X' });
		expect(rejected.tasks[0].suggestion).toBeUndefined();
		expect(rejected.tasks[0].client).toEqual({ id: '5', name: 'Lee', via: 'rule' });
	});
});

describe('moveWindow / toLocalInput', () => {
	it('round-trips a local datetime and emits an offset the gateway accepts', () => {
		const iso = local(2026, 9, 21, 9, 30);
		const input = toLocalInput(iso);
		expect(input).toMatch(/^2026-09-21T09:30$/);
		const out = moveWindow(input, toLocalInput(local(2026, 9, 21, 10)));
		expect('startAt' in out && out.startAt).toBe(new Date(iso).toISOString().replace('Z', '+00:00'));
	});

	it('rejects an empty or backwards window', () => {
		expect(moveWindow('', '2026-09-21T10:00')).toEqual({ error: 'Pick a start and an end time' });
		expect(moveWindow('2026-09-21T10:00', '2026-09-21T09:00')).toEqual({ error: 'End must be after start' });
	});

	it('rejects a malformed datetime', () => {
		expect(moveWindow('not-a-date', '2026-09-21T10:00')).toEqual({ error: 'Pick a start and an end time' });
	});
});

describe('clientLabel', () => {
	it('names who said so', () => {
		expect(clientLabel('pin')).toBe('pinned by you');
		expect(clientLabel('rule')).toBe('matched by rule');
		expect(clientLabel('agent')).toBe('suggested by the agent');
	});
});

describe('sourceChip', () => {
	const fmt = () => '14:30';
	it('the work account shows its address and links to Connections', () => {
		const c = sourceChip('google', {}, { m365: { status: 'disconnected' }, google: { status: 'ok', email: 'a@b.c' } }, fmt);
		expect(c).toMatchObject({ state: 'ok', text: 'a@b.c', action: 'connections' });
	});
	it('a provider that is not the work account is off, with no action of its own', () => {
		expect(sourceChip('m365', {}, null, fmt).state).toBe('off');
		expect(sourceChip('m365', {}, null, fmt).action).toBeUndefined();
		expect(sourceChip('m365', {}, { m365: { status: 'disconnected' }, google: { status: 'ok' } }, fmt).action).toBeUndefined();
	});
	it('a work account needing re-auth, or one the aggregator could not read, asks to reconnect in Connections', () => {
		const rows = { m365: { status: 'reauth' as const }, google: { status: 'ok' as const, email: 'a@b.c' } };
		expect(sourceChip('m365', {}, rows, fmt)).toMatchObject({ state: 'warn', text: 'reconnect', action: 'connections' });
		expect(sourceChip('google', { google: { status: 'error', message: 'x' } }, rows, fmt)).toMatchObject({ state: 'warn', text: 'reconnect' });
	});
	it('a work account missing a send scope asks to reconnect to enable sending', () => {
		const rows = { m365: { status: 'ok' as const, email: 's@b.c', missing_scopes: ['Mail.Send'] }, google: { status: 'disconnected' as const } };
		expect(sourceChip('m365', {}, rows, fmt)).toMatchObject({ state: 'warn', text: 'Reconnect to enable sending', action: 'connections' });
	});
	it('chips: XPLAN then only the work account; none chosen → one "choose" chip', () => {
		const one = sourceChips({}, { m365: { status: 'ok', email: 's@b.c' }, google: { status: 'disconnected' } }, fmt);
		expect(one.map((c) => c.source)).toEqual(['xplan', 'm365']);
		const none = sourceChips({}, { m365: { status: 'disconnected' }, google: { status: 'disconnected' } }, fmt);
		expect(none.map((c) => c.source)).toEqual(['xplan', 'work']);
		expect(none[1]).toMatchObject({ label: 'Work account', action: 'connections' });
		expect(sourceChips({}, null, fmt).map((c) => c.source)).toEqual(['xplan', 'work']);
	});
	it('XPLAN is read, locked or not read yet — never connect', () => {
		expect(sourceChip('xplan', { xplan: { status: 'ok', readAt: '2026-09-20T04:30:00Z' } }, null, fmt)).toMatchObject({ state: 'ok', text: 'read 14:30' });
		expect(sourceChip('xplan', { xplan: { status: 'ok' } }, null, fmt).text).toBe('read');
		expect(sourceChip('xplan', { xplan: { status: 'locked' } }, null, fmt)).toMatchObject({ state: 'warn', text: 'locked' });
		const off = sourceChip('xplan', {}, null, fmt);
		expect(off).toMatchObject({ state: 'off', text: 'not read yet' });
		expect(off.action).toBeUndefined();
	});
});

describe('week navigation', () => {
	it('a week starts on the Sunday at local midnight, as the grid does', () => {
		const s = weekStartOf(new Date(2026, 9, 13, 6, 39));
		expect([s.getFullYear(), s.getMonth(), s.getDate(), s.getDay(), s.getHours()]).toEqual([2026, 9, 11, 0, 0]);
		expect(weekStartOf(new Date(2026, 9, 11, 23, 0)).getDate()).toBe(11);
	});

	it('steps whole weeks, across a month end', () => {
		const back = shiftWeek(new Date(2026, 9, 4), -1);
		expect([back.getMonth(), back.getDate()]).toEqual([8, 27]);
		expect(shiftWeek(new Date(2026, 9, 11), 1).getDate()).toBe(18);
	});

	it('asks the gateway for Sunday to Saturday', () => {
		expect(weekWindow(new Date(2026, 9, 11))).toEqual({ from: '2026-10-11', to: '2026-10-17' });
	});

	it('labels the week compactly, naming a second month or year only when it changes', () => {
		expect(weekLabel(new Date(2026, 9, 11))).toBe('11 – 17 Oct 2026');
		expect(weekLabel(new Date(2026, 8, 27))).toBe('27 Sep – 3 Oct 2026');
		expect(weekLabel(new Date(2026, 11, 27))).toBe('27 Dec 2026 – 2 Jan 2027');
	});

	it('scrolls to 7 AM, or to the week\'s earliest timed event if sooner', () => {
		expect(weekScrollHour([])).toBe(7);
		expect(weekScrollHour([event({ startAt: new Date(2026, 9, 14, 9).toISOString() })])).toBe(7);
		expect(weekScrollHour([event({ startAt: new Date(2026, 9, 14, 6, 30).toISOString() })])).toBe(6);
		expect(weekScrollHour([event({ allDay: true, startAt: '2026-10-14' })])).toBe(7);
	});
});

describe('narrativePoints', () => {
	it('one point per line, blank lines dropped', () => {
		expect(narrativePoints('First.\n\n  Second.  \n')).toEqual(['First.', 'Second.']);
	});

	it('drops a bullet the model wrote itself', () => {
		expect(narrativePoints('- one\n• two\n* three\n1. four')).toEqual(['one', 'two', 'three', 'four']);
	});
});
