// Rows for the stage pages: STAGES (Plan 3's mirror of the contract) gives
// the step ids in process-map order; the titles and one-line details for the
// stages that have pages live here. Stage 1's rows keep their own richer
// table in lib/apps/onboarding.ts (ENQUIRY_ROWS); this covers Stages 2–3.
import { STAGES, type Stage, type Step } from '$lib/apis/gateway/onboarding';

export interface OnboardingRow {
	/** "<stage>.<step>" — the onboarding_action.step key. */
	step: Step;
	id: string;
	title: string;
	detail: string;
}

const COPY: Partial<Record<Step, { title: string; detail: string }>> = {
	'discovery.clarify_goals': { title: 'Clarify Goals', detail: 'What does the client want to achieve, and by when.' },
	'discovery.collect_info': { title: 'Collect Information', detail: 'Assets, liabilities, income, insurance, super.' },
	'discovery.define_scope': { title: 'Define Scope', detail: 'Agree what the advice will and won’t cover.' },
	'discovery.risk_profile': { title: 'Risk Profiling', detail: 'Assess risk tolerance and capacity.' },
	'data_entry.update_xplan': { title: 'Update XPLAN', detail: 'Upload the client’s documents; the agent proposes what to enter. You approve every item.' },
	'data_entry.gather_missing': { title: 'Gather missing information', detail: 'Chase what the fact find and documents did not cover.' },
	'data_entry.product_research': { title: 'Product research', detail: 'Existing products, fees and features — super, insurance, investments.' },
	'data_entry.strategy_modelling': { title: 'Strategy modelling', detail: 'Model the options before the strategy meeting.' }
};

const titleFromId = (id: string) => id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export const rowsFor = (stage: Stage): OnboardingRow[] =>
	STAGES[stage].map((id: string) => {
		const step = `${stage}.${id}` as Step;
		return { step, id, title: COPY[step]?.title ?? titleFromId(id), detail: COPY[step]?.detail ?? '' };
	});
