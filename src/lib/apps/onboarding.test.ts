import { describe, it, expect } from 'vitest';
import {
	ENQUIRY_ROWS,
	BOOK_STEP,
	autoDraftSteps,
	canBook,
	canContinue,
	canSend,
	recipientOf,
	NO_EMAIL_HINT,
	doneCount,
	errorOf,
	isStuckDrafting,
	runningFor,
	slotOf,
	bookingOf,
	bookedByClientOf,
	bookingLinkEmail,
	linkSentOf,
	sendModeOf,
	sendsAgain,
	pickNeedsAgain,
	actionMessage,
	jobRefusal,
	hourSlotStart,
	hourBlock,
	isHourBookable,
	calendarLinksFor,
	isSlotBusy,
	hourRangeLabel,
	OUTLOOK_CALENDAR,
	GOOGLE_CALENDAR
} from './onboarding';
import type { AgendaEvent } from '$lib/apis/gateway/agenda';
import { GatewayError } from '$lib/apis/gateway';
import type { OnboardingAction, OnboardingState } from '$lib/apis/gateway/onboarding';
import { EMPTY_SNAPSHOT } from '$lib/apis/gateway/jobs';

const a = (step: string, status: string, detail: Record<string, unknown> = {}): OnboardingAction =>
	({
		id: step,
		xplanClientId: '1',
		step,
		status,
		draftRef: null,
		draftUrl: null,
		emailRef: null,
		eventRef: null,
		completedBy: null,
		detail,
		updatedAt: null
	}) as OnboardingAction;

const four = (wp: string, fsg: string, ff: string, dm: string) => [
	a('enquiry.welcome_pack', wp),
	a('enquiry.fsg', fsg),
	a('enquiry.fact_find', ff),
	a('enquiry.discovery_meeting', dm)
];

describe('Stage 1 gating', () => {
	it('has the four rows in process-map order', () => {
		expect(ENQUIRY_ROWS.map((r) => r.step)).toEqual([
			'enquiry.welcome_pack',
			'enquiry.fsg',
			'enquiry.fact_find',
			'enquiry.discovery_meeting'
		]);
		expect(BOOK_STEP).toBe('enquiry.discovery_meeting');
	});

	it('Book needs the three documents sent or done', () => {
		expect(canBook(four('done', 'sent', 'sent', 'pending'))).toBe(true);
		expect(canBook(four('done', 'ready', 'sent', 'pending'))).toBe(false);
		expect(canBook([])).toBe(false);
	});

	it('Continue needs all four done', () => {
		expect(canContinue(four('done', 'done', 'done', 'done'))).toBe(true);
		expect(canContinue(four('done', 'done', 'done', 'sent'))).toBe(false);
		expect(doneCount(four('done', 'done', 'pending', 'pending'), 'enquiry')).toBe(2);
	});

	it('auto-drafts pending document rows only, and never without a drive', () => {
		const state = (connected: boolean | null, actions: OnboardingAction[]) =>
			({
				lead: { stage: 'enquiry' },
				actions,
				drive: { connected },
				templates: { 'enquiry.welcome_pack': true, 'enquiry.fsg': true, 'enquiry.fact_find': true }
			}) as unknown as OnboardingState;
		expect(autoDraftSteps(state(true, four('pending', 'ready', 'failed', 'pending')))).toEqual([
			'enquiry.welcome_pack'
		]);
		expect(autoDraftSteps(state(null, four('pending', 'pending', 'pending', 'pending')))).toEqual([
			'enquiry.welcome_pack',
			'enquiry.fsg',
			'enquiry.fact_find'
		]);
		expect(autoDraftSteps(state(false, four('pending', 'pending', 'pending', 'pending')))).toEqual(
			[]
		);
		expect(autoDraftSteps(null)).toEqual([]);
	});

	it('never auto-drafts a row that was drafted or sent before (an untick is not a redraft)', () => {
		const st = (actions: OnboardingAction[]) =>
			({
				lead: { stage: 'enquiry' },
				actions,
				drive: { connected: true },
				templates: { 'enquiry.welcome_pack': true, 'enquiry.fsg': true, 'enquiry.fact_find': true }
			}) as unknown as OnboardingState;
		const unticked = {
			...a('enquiry.fsg', 'pending'),
			draftRef: 'd1',
			emailRef: 'm1'
		} as OnboardingAction;
		const draftedOnly = {
			...a('enquiry.fact_find', 'pending'),
			draftRef: 'd2'
		} as OnboardingAction;
		const sentOnly = {
			...a('enquiry.welcome_pack', 'pending'),
			emailRef: 'm3'
		} as OnboardingAction;
		expect(autoDraftSteps(st([unticked, draftedOnly, sentOnly]))).toEqual([]);
		expect(autoDraftSteps(st([a('enquiry.fsg', 'pending')]))).toEqual(['enquiry.fsg']);
	});

	it('never auto-drafts a row with more than one template to pick from', () => {
		const st = {
			lead: { stage: 'enquiry' },
			actions: [a('enquiry.welcome_pack', 'pending'), a('enquiry.fsg', 'pending')],
			drive: { connected: true },
			templates: { 'enquiry.welcome_pack': true, 'enquiry.fsg': true },
			pickTemplate: { 'enquiry.fsg': true }
		} as unknown as OnboardingState;
		expect(autoDraftSteps(st)).toEqual(['enquiry.welcome_pack']);
	});

	it('Send needs ready and an address', () => {
		expect(canSend(a('enquiry.fsg', 'ready', { email: { to: 'j@x.y' } }))).toBe(true);
		expect(canSend(a('enquiry.fsg', 'ready', { email: { to: null } }))).toBe(false);
		expect(canSend(a('enquiry.fsg', 'pending', { email: { to: 'j@x.y' } }))).toBe(false);
	});

	it('finds the running job for a client and step by params', () => {
		const snap = {
			...EMPTY_SNAPSHOT,
			running: [
				{ id: 'j1', kind: 'onb_draft', params: { client: '1', step: 'enquiry.fsg' } },
				{ id: 'j2', kind: 'deep_sync', params: { clientId: '1' } }
			]
		} as never;
		expect(runningFor(snap, '1', 'enquiry.fsg')?.id).toBe('j1');
		expect(runningFor(snap, '1', 'enquiry.fact_find')).toBeUndefined();
		expect(runningFor(snap, '2', 'enquiry.fsg')).toBeUndefined();
	});

	it('reads error and the chosen slot off detail', () => {
		expect(
			errorOf(
				a('enquiry.fsg', 'failed', {
					error: { code: 'no_email', message: 'No email on file — add it in XPLAN' }
				})
			)?.code
		).toBe('no_email');
		expect(errorOf(a('enquiry.fsg', 'ready'))).toBeNull();
		expect(
			slotOf(a(BOOK_STEP, 'sent', { slot: { start: 's', end: 'e', label: 'Tue' } }))?.label
		).toBe('Tue');
	});

	it('a booked row links to the event and says how the client replied', () => {
		const link = 'https://outlook.office365.com/owa/?itemid=X';
		expect(bookingOf(a(BOOK_STEP, 'sent', { web_link: link, rsvp: 'none', provider: 'm365' }))).toEqual({
			link, where: 'Outlook', reply: 'Awaiting reply', declined: false
		});
		const declined = bookingOf(a(BOOK_STEP, 'sent', { rsvp: 'declined', provider: 'google' }));
		expect(declined).toMatchObject({ link: null, where: 'Google Calendar', reply: 'Declined', declined: true });
		expect(bookingOf(a(BOOK_STEP, 'done', { rsvp: 'declined' })).reply).toBe('Accepted');
		expect(bookingOf(a(BOOK_STEP, 'sent', { web_link: 'javascript:alert(1)' })).link).toBeNull();
	});

	it('auto-drafts only rows whose template exists; no templates map means unknown', () => {
		const withT = (templates?: Record<string, boolean>) =>
			({
				lead: { stage: 'enquiry' },
				actions: four('pending', 'pending', 'pending', 'pending'),
				drive: { connected: true },
				templates
			}) as unknown as OnboardingState;
		expect(autoDraftSteps(withT({ 'enquiry.welcome_pack': true, 'enquiry.fsg': false }))).toEqual([
			'enquiry.welcome_pack'
		]);
		expect(autoDraftSteps(withT(undefined))).toEqual([]);
	});

	it('a drafting row with no running onb_draft job is stuck', () => {
		const row = a('enquiry.fsg', 'drafting');
		const snap = (kind: string) =>
			({
				...EMPTY_SNAPSHOT,
				running: [{ id: 'j1', kind, params: { client: '1', step: 'enquiry.fsg' } }]
			}) as never;
		expect(isStuckDrafting(row, EMPTY_SNAPSHOT, '1')).toBe(true);
		expect(isStuckDrafting(row, snap('onb_draft'), '1')).toBe(false);
		expect(isStuckDrafting(row, snap('onb_send'), '1')).toBe(true);
		expect(isStuckDrafting(a('enquiry.fsg', 'ready'), EMPTY_SNAPSHOT, '1')).toBe(false);
	});
});

describe('Stage 1 page actions', () => {
	const withDraft = (status: string, detail: Record<string, unknown> = {}) =>
		({ ...a('enquiry.fsg', status, detail), draftRef: 'd1' }) as OnboardingAction;

	it('offers Send on ready, Send again on sent, a retry on a failed row that kept its draft', () => {
		expect(sendModeOf(a('enquiry.fsg', 'ready'))).toBe('send');
		expect(sendModeOf(a('enquiry.fsg', 'sent'))).toBe('again');
		expect(sendModeOf(withDraft('failed', { error: { code: 'needs_connector' } }))).toBe('retry');
		expect(sendModeOf(a('enquiry.fsg', 'failed', { error: { code: 'no_template' } }))).toBeNull();
		expect(sendModeOf(a('enquiry.fsg', 'pending'))).toBeNull();
		expect(sendModeOf(a('enquiry.fsg', 'done'))).toBeNull();
	});

	it('a failed row that was sent before only offers Send again (a failed Regenerate)', () => {
		const row = {
			...withDraft('failed', { error: { code: 'no_template' } }),
			emailRef: 'm1'
		} as OnboardingAction;
		expect(sendModeOf(row)).toBe('again');
		expect(sendsAgain(sendModeOf(row)!)).toBe(true);
	});

	it('a sent-but-unrecorded row only offers an explicit Send again', () => {
		const row = withDraft('failed', { error: { code: 'sent_unrecorded' } });
		expect(sendModeOf(row)).toBe('unrecorded');
		expect(sendsAgain('unrecorded')).toBe(true);
		expect(sendsAgain('again')).toBe(true);
		expect(sendsAgain('retry')).toBe(false);
		expect(sendsAgain('send')).toBe(false);
	});

	it('picking a slot on a booked row needs again', () => {
		expect(pickNeedsAgain(a(BOOK_STEP, 'pending'))).toBe(false);
		expect(pickNeedsAgain(a(BOOK_STEP, 'failed', { error: { code: 'slot_busy' } }))).toBe(false);
		expect(pickNeedsAgain(a(BOOK_STEP, 'sent'))).toBe(true);
		expect(pickNeedsAgain(a(BOOK_STEP, 'done'))).toBe(true);
		expect(pickNeedsAgain(a(BOOK_STEP, 'failed', { error: { code: 'sent_unrecorded' } }))).toBe(true);
	});

	it('an unticked meeting that still holds its event counts as booked', () => {
		const row = { ...a(BOOK_STEP, 'pending'), eventRef: 'ev1' } as OnboardingAction;
		expect(pickNeedsAgain(row)).toBe(true);
		const failed = { ...a(BOOK_STEP, 'failed', { error: { code: 'slot_busy' } }), eventRef: 'ev1' };
		expect(pickNeedsAgain(failed as OnboardingAction)).toBe(true);
	});

	it('maps identity_unavailable to sign out and back in; other errors pass through', () => {
		expect(actionMessage(new GatewayError('identity_unavailable', 503))).toMatch(
			/sign out and back in/i
		);
		expect(actionMessage(new GatewayError('job queue unavailable', 503))).toBe(
			'job queue unavailable'
		);
		expect(actionMessage(new Error('boom'))).toBe('boom');
		expect(actionMessage('x')).toBe('x');
	});
});

describe('job-level refusals', () => {
	const snap = (last: Record<string, unknown>) => ({ ...EMPTY_SNAPSHOT, last }) as never;
	const job = (id: string, status: string, error: string | null) => ({ id, kind: 'onb_send', status, error });

	it('finds a finished job by id and returns its error in planner words', () => {
		const s = snap({
			onb_send: job('j1', 'error', 'Another send or booking for this step is in progress'),
			onb_book: job('j2', 'error', 'Already booked'),
			onb_draft: job('j3', 'done', null)
		});
		expect(jobRefusal(s, 'j1')).toBe('Another send or booking for this step is already running');
		expect(jobRefusal(s, 'j2')).toMatch(/already booked/i);
		expect(jobRefusal(s, 'j3')).toBeNull();
		expect(jobRefusal(s, 'nope')).toBeNull();
	});

	it('maps the lock failure to busy and passes other text through', () => {
		const s = snap({
			onb_send: job('j1', 'error', 'Could not take the send lock — try again in a moment'),
			onb_book: job('j2', 'error', 'That hour is busy in your calendar — free it there first')
		});
		expect(jobRefusal(s, 'j1')).toBe('Another send or booking for this step is already running');
		expect(jobRefusal(s, 'j2')).toBe('That hour is busy in your calendar — free it there first');
	});
});

describe('NO_EMAIL_HINT', () => {
	it('tells the planner where to add the email and what to do after', () => {
		expect(NO_EMAIL_HINT).toMatch(/XPLAN/);
		expect(NO_EMAIL_HINT).toMatch(/Re-read from XPLAN/);
	});
});

describe('recipientOf / canSend with the client contact', () => {
	const ready = { step: 'enquiry.fsg', status: 'ready', detail: { email: { to: null } } } as never;
	const contact = { email: 'john@example.com', emails: ['john@example.com'], phone: null };
	it('falls back to the client email from XPLAN when the draft has none', () => {
		expect(recipientOf(ready, contact)).toBe('john@example.com');
		expect(canSend(ready, contact)).toBe(true);
	});
	it('stays off with no address anywhere', () => {
		expect(canSend(ready, { email: null, emails: [], phone: null })).toBe(false);
		expect(canSend(ready, null)).toBe(false);
	});
	it('keeps the draft recipient first', () => {
		const drafted = { step: 'enquiry.fsg', status: 'ready', detail: { email: { to: 'a@x.com' } } } as never;
		expect(recipientOf(drafted, contact)).toBe('a@x.com');
	});
});

describe('the booking link', () => {
	it('a link-mode row says who the link went to; an invite row is not a link row', () => {
		expect(linkSentOf(a(BOOK_STEP, 'sent', { mode: 'link', sent_to: 'john@example.com' }))).toEqual({
			to: 'john@example.com'
		});
		expect(linkSentOf(a(BOOK_STEP, 'sent', { mode: 'invite', sent_to: 'x@y.z' }))).toBeNull();
		expect(linkSentOf(a(BOOK_STEP, 'sent', {}))).toBeNull();
	});

	it('a client booking reads "Booked by the client", never "Accepted"', () => {
		const done = a(BOOK_STEP, 'done', {
			mode: 'link',
			evidence: { kind: 'booked', start: '2026-10-16T00:00:00+00:00' },
			web_link: 'https://outlook.office.com/calendar/item/e-1'
		});
		const b = bookedByClientOf(done, 'Australia/Sydney');
		expect(b?.label).toBe('Fri 16 Oct, 11:00 AM');
		expect(bookingOf(done).reply).toBe('Booked by the client');
		expect(bookedByClientOf(a(BOOK_STEP, 'done', { evidence: { kind: 'accepted' } }))).toBeNull();
		expect(bookedByClientOf(a(BOOK_STEP, 'sent', { evidence: { kind: 'booked', start: 'x' } }))).toBeNull();
	});

	it('the default wording greets the client by first name from either name order', () => {
		expect(bookingLinkEmail('Smith, John').html).toContain('<p>Hi John,</p>');
		expect(bookingLinkEmail('Mary Jones').html).toContain('<p>Hi Mary,</p>');
		expect(bookingLinkEmail('').html).toContain('<p>Hi there,</p>');
		expect(bookingLinkEmail('<b>x</b>, <i>').html).not.toContain('<b>');
		expect(bookingLinkEmail('Smith, John').subject).toBe('Book your discovery meeting');
	});
});

describe('booking an hour', () => {
	const now = new Date(2026, 9, 13, 10, 30); // Tue 13 Oct 2026, 10:30 local
	const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m);
	const ev = (startAt: string, endAt: string, extra: Partial<AgendaEvent> = {}): AgendaEvent => ({
		id: startAt,
		source: 'm365',
		sourceId: 'x',
		title: 'Busy',
		startAt,
		endAt,
		allDay: false,
		attendees: [],
		href: '',
		writable: false,
		...extra
	});
	const iso = (d: Date) => d.toISOString();

	it('hourSlotStart is the hour on the wall clock with the local offset', () => {
		const d = at(15, 9, 42);
		const s = hourSlotStart(d);
		expect(s).toMatch(/^2026-10-15T09:00:00[+-]\d{2}:\d{2}$/);
		expect(Date.parse(s)).toBe(at(15, 9).getTime());
		const off = -at(15, 9).getTimezoneOffset();
		const sign = off < 0 ? '-' : '+';
		const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
		const mm = String(Math.abs(off) % 60).padStart(2, '0');
		expect(s.endsWith(`${sign}${hh}:${mm}`)).toBe(true);
	});

	it('a free future hour is bookable', () => {
		expect(isHourBookable(at(15, 9), [], now)).toBe(true);
		expect(hourBlock(at(15, 9), [], now)).toBeNull();
	});

	it('an hour that has started or passed is not', () => {
		expect(hourBlock(at(13, 10), [], now)).toEqual({ kind: 'past' });
		expect(hourBlock(at(12, 15), [], now)).toEqual({ kind: 'past' });
		expect(isHourBookable(at(13, 11), [], now)).toBe(true);
	});

	it('an hour past the 90-day horizon is not', () => {
		expect(hourBlock(new Date(2027, 0, 20, 9), [], now)).toEqual({ kind: 'too_far' });
	});

	it('any overlap with a timed event blocks the hour', () => {
		const e = ev(iso(at(15, 9, 30)), iso(at(15, 10, 30)));
		expect(hourBlock(at(15, 9), [e], now)).toEqual({ kind: 'busy', events: [e] });
		expect(isHourBookable(at(15, 10), [e], now)).toBe(false);
		const long = ev(iso(at(15, 8)), iso(at(15, 12)));
		expect(isHourBookable(at(15, 10), [long], now)).toBe(false);
	});

	it('events that only touch the edges do not', () => {
		const before = ev(iso(at(15, 8)), iso(at(15, 9)));
		const after = ev(iso(at(15, 10)), iso(at(15, 11)));
		expect(isHourBookable(at(15, 9), [before, after], now)).toBe(true);
	});

	it('a zero-length event holds the hour it sits in', () => {
		const point = ev(iso(at(15, 9)), '');
		expect(isHourBookable(at(15, 9), [point], now)).toBe(false);
		expect(isHourBookable(at(15, 8), [point], now)).toBe(true);
	});

	it('an all-day event blocks every hour of its days, and only those', () => {
		const leave = ev('2026-10-15', '2026-10-16', { allDay: true, source: 'google' });
		expect(isHourBookable(at(15, 9), [leave], now)).toBe(false);
		expect(isHourBookable(at(16, 17), [leave], now)).toBe(false);
		expect(isHourBookable(at(17, 9), [leave], now)).toBe(true);
	});

	it('links to the busy events’ calendars, both when unsure', () => {
		expect(calendarLinksFor(['m365'])).toEqual([OUTLOOK_CALENDAR]);
		expect(calendarLinksFor(['google', 'google'])).toEqual([GOOGLE_CALENDAR]);
		expect(calendarLinksFor(['m365', 'google'])).toEqual([OUTLOOK_CALENDAR, GOOGLE_CALENDAR]);
		expect(calendarLinksFor(['xplan'])).toEqual([OUTLOOK_CALENDAR, GOOGLE_CALENDAR]);
		expect(calendarLinksFor([])).toEqual([OUTLOOK_CALENDAR, GOOGLE_CALENDAR]);
	});

	it('spots the slot_busy refusal by its text', () => {
		expect(isSlotBusy('That hour is busy in your calendar — free it there first')).toBe(true);
		expect(isSlotBusy('Already booked')).toBe(false);
		expect(isSlotBusy(null)).toBe(false);
	});

	it('labels the hour as a range in the planner’s zone', () => {
		const tz = 'Australia/Sydney';
		expect(hourRangeLabel(new Date('2026-10-15T09:00:00+11:00'), tz)).toBe('Thu 15 Oct, 9:00–10:00 AM');
		expect(hourRangeLabel(new Date('2026-10-15T11:00:00+11:00'), tz)).toBe(
			'Thu 15 Oct, 11:00 AM–12:00 PM'
		);
	});
});
