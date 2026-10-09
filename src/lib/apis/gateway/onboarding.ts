// Per-client onboarding state — the Stage 1-3 pages and the Clients hub.
//
// Types MIRROR shared-contracts/types/onboarding.ts (hand-sync convention,
// see lib/apis/xplan/index.ts:161 — shared-contracts is not in this build's
// context). onboarding.test.ts asserts STAGES equals the contract's.
// Contract: shared-contracts/onboarding-stages.md §4.
import { gatewayError, gatewayUrl } from './index';

export const STAGES = {
	enquiry: ['welcome_pack', 'fsg', 'fact_find', 'discovery_meeting'],
	discovery: ['clarify_goals', 'collect_info', 'define_scope', 'risk_profile'],
	data_entry: ['update_xplan', 'gather_missing', 'product_research', 'strategy_modelling'],
	strategy: ['adviser_review', 'paraplanning', 'research_validation'],
	advice_prep: ['soa_preparation', 'compliance_checks'],
	advice_presentation: ['present_advice', 'obtain_instructions', 'sign_documents'],
	implementation: [
		'applications',
		'provider_liaison',
		'track_progress',
		'final_checks',
		'client_updates',
		'xplan_updates'
	],
	ongoing: ['annual_reviews', 'review_packs', 'updated_advice', 'fee_consents'],
	archive: ['record_decision', 'future_follow_up', 'archive_file']
} as const;

export type Stage = keyof typeof STAGES;
/** `"<stage>.<step>"`, e.g. `"enquiry.fsg"`. */
export type Step = { [S in Stage]: `${S}.${(typeof STAGES)[S][number]}` }[Stage];
export type ActionStatus = 'pending' | 'drafting' | 'ready' | 'sent' | 'done' | 'failed';
export type Actor = 'planner' | 'agent';

export interface OnboardingLead {
	xplanClientId: string;
	owner: string;
	stage: Stage;
	createdAt: string | null;
	updatedAt: string | null;
	/** Present on the list route only. */
	done?: number;
	total?: number;
}

export interface OnboardingAction {
	id: string;
	xplanClientId: string;
	step: Step;
	status: ActionStatus;
	draftRef: string | null;
	draftUrl: string | null;
	emailRef: string | null;
	eventRef: string | null;
	completedBy: Actor | null;
	detail: Record<string, unknown>;
	updatedAt: string | null;
}

export interface OnboardingActivity {
	id: string;
	xplanClientId: string;
	step: Step | null;
	actor: Actor;
	event: string;
	detail: Record<string, unknown>;
	createdAt: string | null;
}

/** `GET /gw/onboarding/{client}` */
export interface OnboardingState {
	lead: OnboardingLead;
	actions: OnboardingAction[];
	/** null when salem could not be asked. */
	drive: { connected: boolean | null };
	/**
	 * Per step: does a published template exist (amendment R14). Missing on an
	 * older gateway — read that as "unknown", never as "all present".
	 */
	templates?: Record<string, boolean>;
}

export type OnboardingJobKind = 'onb_draft' | 'onb_send' | 'onb_book';

const auth = (token: string) => ({
	Authorization: `Bearer ${token}`,
	'Content-Type': 'application/json'
});

const base = (client: string) => `${gatewayUrl()}/gw/onboarding/${encodeURIComponent(client)}`;

export const getOnboarding = async (token: string, client: string): Promise<OnboardingState> => {
	const res = await fetch(base(client), { headers: auth(token) });
	if (!res.ok) throw await gatewayError(res);
	return await res.json();
};

export const setStage = async (
	token: string,
	client: string,
	stage: Stage
): Promise<{ lead: OnboardingLead; actions: OnboardingAction[] }> => {
	const res = await fetch(`${base(client)}/stage`, {
		method: 'PUT',
		headers: auth(token),
		body: JSON.stringify({ stage })
	});
	if (!res.ok) throw await gatewayError(res);
	return await res.json();
};

/** Manual tick / untick. The gateway refuses while a draft is running (409). */
export const setAction = async (
	token: string,
	client: string,
	step: Step,
	status: 'done' | 'pending'
): Promise<OnboardingAction> => {
	const res = await fetch(`${base(client)}/actions/${step}`, {
		method: 'PUT',
		headers: auth(token),
		body: JSON.stringify({ status })
	});
	if (!res.ok) throw await gatewayError(res);
	return (await res.json()).action;
};

/**
 * Queue one action's job. A second click adopts the running job (200 with
 * its id, never 409). A gate refusal is a 409 whose message says why.
 */
export const runAction = async (
	token: string,
	client: string,
	step: Step,
	kind: OnboardingJobKind,
	args: Record<string, unknown> = {}
): Promise<{ jobId: string; status: string }> => {
	const res = await fetch(`${base(client)}/actions/${step}/run`, {
		method: 'POST',
		headers: auth(token),
		body: JSON.stringify({ kind, args })
	});
	if (!res.ok) throw await gatewayError(res);
	return await res.json();
};

export const getActivity = async (token: string, client: string): Promise<OnboardingActivity[]> => {
	const res = await fetch(`${base(client)}/activity`, { headers: auth(token) });
	if (!res.ok) throw await gatewayError(res);
	return (await res.json()).activity ?? [];
};

export const listLeads = async (token: string, stage?: Stage): Promise<OnboardingLead[]> => {
	const url = `${gatewayUrl()}/gw/onboarding${stage ? `?stage=${stage}` : ''}`;
	const res = await fetch(url, { headers: auth(token) });
	if (!res.ok) throw await gatewayError(res);
	return (await res.json()).leads ?? [];
};
