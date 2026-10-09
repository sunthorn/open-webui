// Stage 2's reading of the onboarding state — pure, so it is testable
// (axi's vitest has no jsdom; nothing inside a .svelte file is reachable).
// Contract: shared-contracts/onboarding-stages.md §8 (notes), §9 (analysis).
import {
	STAGES,
	type OnboardingAction,
	type Stage,
	type Step,
	type StepAnalysis
} from '$lib/apis/gateway/onboarding';
import type { JobsSnapshot, SyncJob } from '$lib/apis/gateway/jobs';

/** The stages in process-map order — the order STAGES declares them. */
export const STAGE_ORDER = Object.keys(STAGES) as Stage[];

export const stageAtLeast = (stage: string | null | undefined, floor: Stage): boolean => {
	const i = STAGE_ORDER.indexOf(stage as Stage);
	return i >= 0 && i >= STAGE_ORDER.indexOf(floor);
};

export const DISCOVERY_STEPS = ['clarify_goals', 'collect_info', 'define_scope', 'risk_profile'] as const;
export type DiscoveryStep = (typeof DISCOVERY_STEPS)[number];

export const stepId = (s: DiscoveryStep): Step => `discovery.${s}` as Step;

const discoveryActions = (actions: OnboardingAction[]) =>
	actions.filter((a) => a.step.startsWith('discovery.'));

export const analysisOf = (action: OnboardingAction | null | undefined): StepAnalysis | null => {
	const a = action?.detail?.analysis;
	return a && Array.isArray(a.findings) ? (a as StepAnalysis) : null;
};

/** The run before the latest one (no source_index), or null on a first run. */
export const previousOf = (
	action: OnboardingAction | null | undefined
): Omit<StepAnalysis, 'source_index'> | null => {
	const p = action?.detail?.previous;
	return p && Array.isArray(p.findings) ? p : null;
};

/** How many source ids are new on this row since the run before. */
export const changedCount = (action: OnboardingAction | null | undefined): number => {
	const c = action?.detail?.changed_since;
	return Array.isArray(c) ? c.length : 0;
};

/** How many source ids the last run found new — the largest per-step count,
 *  since every step is diffed against the same index. */
export const newSinceLastRun = (actions: OnboardingAction[]): number =>
	Math.max(0, ...discoveryActions(actions).map(changedCount));

export const lastRunAt = (actions: OnboardingAction[]): string | null =>
	discoveryActions(actions)
		.map((a) => analysisOf(a)?.run_at ?? null)
		.filter((x): x is string => !!x)
		.sort()
		.at(-1) ?? null;

/** Stores the last run could not read, deduplicated across steps. */
export const skippedStores = (actions: OnboardingAction[]): string[] =>
	Array.from(new Set(discoveryActions(actions).flatMap((a) => analysisOf(a)?.skipped ?? [])));

export const confidenceLabel = (c: number): 'Well covered' | 'Partly covered' | 'Little evidence' =>
	c >= 0.75 ? 'Well covered' : c >= 0.4 ? 'Partly covered' : 'Little evidence';

export const confidenceClass = (c: number): string =>
	c >= 0.75
		? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
		: c >= 0.4
			? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
			: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300';

export const discoveryDone = (actions: OnboardingAction[]): boolean => {
	const rows = discoveryActions(actions);
	return rows.length === DISCOVERY_STEPS.length && rows.every((a) => a.status === 'done');
};

/** The onb_analyse jobs queued or running for THIS client. One job covers all
 *  four rows, so it is matched on `params.client` only — never the step it
 *  was started from (onboarding-stages.md §9). */
export const analyseJobs = (snap: JobsSnapshot, client: string): SyncJob[] =>
	snap.running.filter((j) => j.kind === 'onb_analyse' && j.params?.client === client);

export const isAnalysing = (snap: JobsSnapshot, client: string): boolean =>
	analyseJobs(snap, client).length > 0;

export interface AnalyseOutcome {
	kind: 'skipped' | 'error' | 'warning';
	text: string;
}

/**
 * Why this client's last finished analyse did not simply succeed — or null.
 * A skipped run ("nothing gathered yet") or a failed one changes no row, so
 * without this the click looks like it did nothing; a done run can still
 * carry a warning in `error`.
 */
export const analyseOutcome = (snap: JobsSnapshot, client: string): AnalyseOutcome | null => {
	const job = snap.last.onb_analyse;
	if (!job || job.params?.client !== client) return null;
	const text = job.error?.trim() ?? '';
	if (job.status === 'skipped') return { kind: 'skipped', text: text || 'Nothing to analyse yet.' };
	if (job.status === 'error') return { kind: 'error', text: text || 'The analysis failed.' };
	if (job.status === 'done' && text) return { kind: 'warning', text };
	return null;
};

/**
 * The note drafts after a reload: the saved notes, except where the planner
 * is still typing (`keep` — a save pending or in flight), whose draft wins.
 */
export const mergeNoteDrafts = (
	drafts: Record<string, string>,
	actions: OnboardingAction[],
	keep: Iterable<string>
): Record<string, string> => {
	const held = new Set(keep);
	const next: Record<string, string> = {};
	for (const a of actions) {
		const saved = typeof a.detail?.notes === 'string' ? a.detail.notes : '';
		next[a.step] = held.has(a.step) && a.step in drafts ? drafts[a.step] : saved;
	}
	return next;
};

/**
 * The steps whose draft a reload must keep: those still being typed or saved
 * now (`held`), plus any whose revision moved while the GET was out — that
 * GET may have read the server before the keystroke or save it missed.
 */
export const notesToKeep = (
	held: Iterable<string>,
	revAtStart: Record<string, number>,
	revNow: Record<string, number>
): string[] => {
	const keep = new Set(held);
	for (const [step, rev] of Object.entries(revNow)) if ((revAtStart[step] ?? 0) !== rev) keep.add(step);
	return [...keep];
};
