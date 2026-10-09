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
	slotOf
} from './onboarding';
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
