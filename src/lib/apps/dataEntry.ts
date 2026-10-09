// Stage 3's pure pieces: how the wizard session is keyed and resumed, and
// what finny will accept. Kept out of the .svelte file so vitest can reach it.
import type { ExtractedDoc, OnboardingProposal } from '$lib/apis/onboarding';

export type WizardStage = 'upload' | 'review' | 'write';

/** Mirrors OnboardingSession in shared-contracts/api-responses.ts — keep in sync. */
export interface OnboardingSession {
	sessionId: string;
	stage: 'draft' | 'proposed' | 'reviewed' | 'written';
	proposal: OnboardingProposal;
	updatedAt: string;
}

/** One session per client: the stored key becomes `onboarding:{client}`. */
export const sessionIdFor = (clientId: string): string => clientId;

export const resumeFrom = (
	session: OnboardingSession | null
): { stage: WizardStage; proposal: OnboardingProposal | null } => {
	const items = session?.proposal?.items;
	if (!session || !Array.isArray(items) || items.length === 0) return { stage: 'upload', proposal: null };
	// 'written' never happens in Phase A; 'reviewed' comes back to review so
	// the approvals can still be changed before Phase B exists.
	return { stage: 'review', proposal: session.proposal };
};

/**
 * What "Start over" saves over the client's session: a draft with no items,
 * which resumeFrom maps back to the upload step — so a reload does not bring
 * back the proposal the planner just discarded.
 */
export const discardedSession = (
	clientId: string,
	proposal: OnboardingProposal,
	now: string = new Date().toISOString()
): OnboardingSession => ({
	sessionId: sessionIdFor(clientId),
	stage: 'draft',
	proposal: { ...proposal, items: [] },
	updatedAt: now
});

const keyOf = (d: ExtractedDoc) => d.documentId ?? d.filename;

export const mergeDocs = (existing: ExtractedDoc[], incoming: ExtractedDoc[]): ExtractedDoc[] => {
	const seen = new Set(existing.map(keyOf));
	const out = [...existing];
	for (const d of incoming) {
		if (seen.has(keyOf(d))) continue;
		seen.add(keyOf(d));
		out.push(d);
	}
	return out;
};

/**
 * A dropped file's identity for this page: an upload is remembered under it,
 * so retrying after the proposal step failed reuses the finny document
 * instead of uploading a duplicate into the client's store.
 */
export const fileKey = (f: { name: string; size: number }): string => `${f.name}:${f.size}`;

/** finny's ALLOWED_CONTENT_TYPES (documents.service.ts). No text/plain. */
export const ACCEPTED_TYPES = [
	'application/pdf',
	'application/msword',
	'application/vnd.ms-word',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	'image/png',
	'image/jpeg'
] as const;
