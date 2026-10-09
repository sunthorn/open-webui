// Stage pages' shared logic — rows, gating, running-job lookup, chips.
// Pure: the Svelte pages render these; nothing here fetches.
// Spec: docs/superpowers/specs/2026-10-08-client-onboarding-design.md §5.4.
import { GatewayError } from '$lib/apis/gateway';
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
 * never re-run automatically: its message is the point. Only a row that
 * was never drafted or sent: a `pending` row with a draftRef or emailRef
 * is an untick, which means "not done yet", not "make a new document" —
 * the explicit Draft button is still there for that.
 */
export const autoDraftSteps = (state: OnboardingState | null): Step[] => {
	if (!state || state.drive.connected === false) return [];
	const templates = state.templates;
	if (!templates) return [];
	return state.actions
		.filter(
			(a) =>
				a.status === 'pending' &&
				!a.draftRef &&
				!a.emailRef &&
				DOCUMENT_STEPS.includes(a.step) &&
				templates[a.step] === true
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

/**
 * Which Send a document row offers (onboarding-stages.md §4 send gate):
 * `send` on ready; `again` on sent, or on a failed row that was ever sent
 * (has an emailRef); `retry` on a failed row that kept its draft and was
 * never sent (a send-side failure); `unrecorded` when the mail went out but the
 * row could not say so — only an explicit "Send again" is offered then,
 * because a plain retry would mail the client twice.
 */
export type SendMode = 'send' | 'again' | 'retry' | 'unrecorded';

export const sendModeOf = (a: OnboardingAction): SendMode | null => {
	if (a.status === 'ready') return 'send';
	if (a.status === 'sent') return 'again';
	if (a.status === 'failed' && a.draftRef) {
		if (errorOf(a)?.code === 'sent_unrecorded') return 'unrecorded';
		// Sent before (a Regenerate that then failed): a plain Send would mail
		// the client the same document twice.
		return a.emailRef ? 'again' : 'retry';
	}
	return null;
};

/** Does this Send carry `args.again`? */
export const sendsAgain = (mode: SendMode): boolean => mode === 'again' || mode === 'unrecorded';

/**
 * A slot pick on a booked row (sent/done, or booked-but-unrecorded) must say
 * `again`: booking clears the offered slots, so "Book again" first proposes
 * fresh ones without a slot, and the pick is the explicit second invite.
 * A row holding an eventRef has an invite out whatever its status (an
 * untick keeps it), so it counts as booked too.
 */
export const pickNeedsAgain = (a: OnboardingAction): boolean =>
	!!a.eventRef ||
	a.status === 'sent' ||
	a.status === 'done' ||
	(a.status === 'failed' && errorOf(a)?.code === 'sent_unrecorded');

/** A gateway refusal as the planner should read it. */
export const actionMessage = (e: unknown): string => {
	if (e instanceof GatewayError && e.status === 503 && e.message === 'identity_unavailable')
		return 'axi could not act as you — sign out and back in, then try again.';
	return e instanceof Error ? e.message : String(e);
};

const BUSY = 'Another send or booking for this step is already running';

/**
 * Why a finished onboarding job refused, in planner words — or null when it
 * did not fail. A refusal (busy, already sent/booked, bad slot) fails only
 * the job and leaves the row untouched, so without this the click looks
 * like it did nothing. The job carries the message text, not the code.
 */
export const jobRefusal = (snap: JobsSnapshot, jobId: string): string | null => {
	const job = Object.values(snap.last).find((j) => j?.id === jobId);
	if (!job || job.status !== 'error' || !job.error) return null;
	const text = job.error.trim();
	if (/^Another send or booking|^Could not take the send lock/.test(text)) return BUSY;
	if (/^Already booked/.test(text))
		return 'Already booked — use Book again to send a second invite';
	if (/^Already sent/.test(text)) return 'Already sent — use Send again';
	return text;
};

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
