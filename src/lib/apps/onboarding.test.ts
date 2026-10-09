import { describe, it, expect } from 'vitest';
import {
	ENQUIRY_ROWS,
	BOOK_STEP,
	autoDraftSteps,
	canBook,
	canContinue,
	canSend,
	doneCount,
	errorOf,
	isStuckDrafting,
	runningFor,
	slotOf,
	sendModeOf,
	sendsAgain,
	pickNeedsAgain,
	actionMessage,
	jobRefusal
} from './onboarding';
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
		expect(pickNeedsAgain(a(BOOK_STEP, 'failed', { error: { code: 'no_slots' } }))).toBe(false);
		expect(pickNeedsAgain(a(BOOK_STEP, 'sent'))).toBe(true);
		expect(pickNeedsAgain(a(BOOK_STEP, 'done'))).toBe(true);
		expect(pickNeedsAgain(a(BOOK_STEP, 'failed', { error: { code: 'sent_unrecorded' } }))).toBe(true);
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
			onb_book: job('j2', 'error', 'That slot is no longer offered — pick again')
		});
		expect(jobRefusal(s, 'j1')).toBe('Another send or booking for this step is already running');
		expect(jobRefusal(s, 'j2')).toBe('That slot is no longer offered — pick again');
	});
});
