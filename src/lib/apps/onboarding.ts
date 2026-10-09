// Stage pages' shared logic — rows, gating, running-job lookup, chips.
// Pure: the Svelte pages render these; nothing here fetches.
// Spec: docs/superpowers/specs/2026-10-08-client-onboarding-design.md §5.4.
import type { JobsSnapshot, SyncJob } from '$lib/apis/gateway/jobs';
import type {
	ActionStatus,
	OnboardingAction,
	OnboardingState,
	Stage,
	Step
} from '$lib/apis/gateway/onboarding';

export interface EnquiryRow {
	step: Step;
	title: string;
	detail: string;
	kind: 'document' | 'booking';
}

export const ENQUIRY_ROWS: EnquiryRow[] = [
	{
		step: 'enquiry.welcome_pack',
		title: 'Welcome Pack',
		kind: 'document',
		detail:
			'Drafted from the Welcome Pack template into the client’s folder, then emailed from your mailbox. Done at send.'
	},
	{
		step: 'enquiry.fsg',
		title: 'FSG',
		kind: 'document',
		detail:
			'Financial Services Guide — drafted and emailed. Done when the client replies or a file comes back.'
	},
	{
		step: 'enquiry.fact_find',
		title: 'Fact Find',
		kind: 'document',
		detail: 'Drafted and emailed. Done when the completed form comes back.'
	},
	{
		step: 'enquiry.discovery_meeting',
		title: 'Book Discovery Meeting',
		kind: 'booking',
		detail:
			'Three free hours from your calendar; the invite goes to the client. Done when they accept.'
	}
];

export const DOCUMENT_STEPS: Step[] = ['enquiry.welcome_pack', 'enquiry.fsg', 'enquiry.fact_find'];
export const BOOK_STEP: Step = 'enquiry.discovery_meeting';

export const STAGE_LABEL: Record<Stage, string> = {
	enquiry: 'New Client Enquiry',
	discovery: 'Discovery Meeting',
	data_entry: 'Data Entry & Research',
	strategy: 'Strategy Development',
	advice_prep: 'Advice Preparation',
	advice_presentation: 'Advice Presentation',
	implementation: 'Implementation',
	ongoing: 'Ongoing Service',
	archive: 'Record & Archive'
};

/** Where a lead's stage opens. Stages without a page open the client detail. */
export const STAGE_PAGE: Partial<Record<Stage, string>> = {
	enquiry: '/apps/enquiry',
	discovery: '/apps/discovery',
	data_entry: '/apps/data-entry'
};

export const byStep = (actions: OnboardingAction[]): Map<string, OnboardingAction> =>
	new Map(actions.map((a) => [a.step, a]));

const has = (a: OnboardingAction | undefined, ...statuses: ActionStatus[]): boolean =>
	!!a && statuses.includes(a.status);

/** Book Discovery Meeting is enabled once the three documents are sent or done. */
export const canBook = (actions: OnboardingAction[]): boolean => {
	const m = byStep(actions);
	return DOCUMENT_STEPS.every((s) => has(m.get(s), 'sent', 'done'));
};

/** Continue to Discovery needs all four done. */
export const canContinue = (actions: OnboardingAction[]): boolean => {
	const m = byStep(actions);
	return ENQUIRY_ROWS.every((r) => has(m.get(r.step), 'done'));
};

export const doneCount = (actions: OnboardingAction[], stage: Stage): number =>
	actions.filter((a) => a.step.startsWith(`${stage}.`) && a.status === 'done').length;

/**
 * On open, every pending document row whose template exists is drafted
 * (spec §5.4, amendment R14) — unless salem says there is no drive, when
 * each would only fail with no_client_folder. A missing `templates` map
 * means the gateway did not say: do not draft blind. A `failed` row is
 * never re-run automatically: its message is the point.
 */
export const autoDraftSteps = (state: OnboardingState | null): Step[] => {
	if (!state || state.drive.connected === false) return [];
	const templates = state.templates;
	if (!templates) return [];
	return state.actions
		.filter(
			(a) => a.status === 'pending' && DOCUMENT_STEPS.includes(a.step) && templates[a.step] === true
		)
		.map((a) => a.step);
};

export const emailOf = (a: OnboardingAction) =>
	(a.detail?.email as
		| { subject?: string; html?: string; text?: string; to?: string | null }
		| undefined) ?? null;

export const errorOf = (a: OnboardingAction) =>
	(a.detail?.error as { code?: string; message?: string } | undefined) ?? null;

export const slotsOf = (a: OnboardingAction) =>
	(a.detail?.slots as { start: string; end: string; label: string }[] | undefined) ?? [];

export const slotOf = (a: OnboardingAction) =>
	(a.detail?.slot as { start: string; end: string; label: string } | undefined) ?? null;

export const canSend = (a: OnboardingAction): boolean => a.status === 'ready' && !!emailOf(a)?.to;

/** The onboarding job queued or running for this client and step, if any. */
export const runningFor = (snap: JobsSnapshot, client: string, step: string): SyncJob | undefined =>
	snap.running.find(
		(j) => j.kind.startsWith('onb_') && j.params?.client === client && j.params?.step === step
	);

/**
 * A `drafting` row with no running onb_draft job is stuck (cancelled before
 * it started, queue lost; amendment R6) — the page offers "Try again".
 */
export const isStuckDrafting = (a: OnboardingAction, snap: JobsSnapshot, client: string): boolean =>
	a.status === 'drafting' &&
	!snap.running.some(
		(j) => j.kind === 'onb_draft' && j.params?.client === client && j.params?.step === a.step
	);

export const STATUS_CHIP: Record<ActionStatus, { label: string; class: string }> = {
	pending: {
		label: 'To do',
		class: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
	},
	drafting: {
		label: 'Drafting…',
		class: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
	},
	ready: {
		label: 'Ready to send',
		class: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
	},
	sent: {
		label: 'Sent',
		class: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
	},
	done: {
		label: 'Done',
		class: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
	},
	failed: {
		label: 'Needs attention',
		class: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
	}
};
