// Jobs a framed app may ask the shell to start on its behalf.
//
// finny and salem run inside an iframe on this origin. contact-layer's /gw/jobs
// routes take only a Bearer axi token (cookie auth is refused there: CSRF), and
// a framed app is not to read the shell's storage for one. So the frame asks,
// and the shell — which holds the token — starts the job and reports back.
// The allowlist and checks here are the contract, not a security boundary: a
// same-origin frame could read the shell's storage outright.
// Pure functions here so vitest (no jsdom) can cover them; the page wires them.
// Contract: shared-contracts/shell-messages-spec.md
import type { JobsSnapshot, SyncJob, SyncJobKind, SyncJobStatus } from '$lib/apis/gateway/jobs';

/** An allowlist, not SyncJobKind: a frame must never start a book sweep or a briefing. */
/**
 * Is this message event one the shell should even parse? Only finny, only
 * the shell's own frame, only this origin. The contract, not a security
 * boundary: a same-origin frame could read the shell's storage outright.
 */
export const fromOurFrame = (
	appId: string | undefined,
	origin: string,
	shellOrigin: string,
	fromFrame: boolean
): boolean => appId === 'finny' && origin === shellOrigin && fromFrame;

export const FRAME_JOB_KINDS = ['profile_fill'] as const;
export type FrameJobKind = (typeof FRAME_JOB_KINDS)[number];

export interface FrameJobRequest {
	kind: FrameJobKind;
	clientId: string;
	requestId: string;
}

// Same shape contact-layer's _check_key accepts; anything else never leaves the page.
const ID_RE = /^[A-Za-z0-9:_-]{1,128}$/;

export const parseFrameRequest = (data: unknown): FrameJobRequest | null => {
	if (!data || typeof data !== 'object') return null;
	const d = data as Record<string, unknown>;
	if (d.axi !== 'run-job') return null;
	if (!(FRAME_JOB_KINDS as readonly string[]).includes(String(d.kind))) return null;
	if (typeof d.clientId !== 'string' || !ID_RE.test(d.clientId)) return null;
	if (typeof d.requestId !== 'string' || !ID_RE.test(d.requestId)) return null;
	return { kind: d.kind as FrameJobKind, clientId: d.clientId, requestId: d.requestId };
};

export const startedMessage = (requestId: string, job: SyncJob | null, error: string | null) =>
	job
		? { axi: 'job', requestId, jobId: job.id, status: job.status }
		: {
				axi: 'job',
				requestId,
				jobId: null,
				status: 'error',
				error: error ?? 'could not start the job'
			};

/**
 * The finished message for a tracked job, or null while it is still queued or
 * running. `last[kind]` is the server's word on how it ended; a job that left
 * `running` without becoming `last` (another of its kind finished after it)
 * is reported `unknown` so the frame stops waiting and simply refetches.
 * Callers should go through `settleTracked`, which gives `unknown` a grace
 * snapshot; this alone would call a job unknown on one stale poll.
 */
export const finishedMessage = (snap: JobsSnapshot, jobId: string, kind: SyncJobKind) => {
	if (snap.running.some((j) => j.id === jobId)) return null;
	const last = snap.last[kind];
	const mine = !!last && last.id === jobId;
	const status: SyncJobStatus | 'unknown' = mine ? last.status : 'unknown';
	return {
		axi: 'job-finished',
		jobId,
		kind,
		clientId: mine ? (last.params?.client ?? last.params?.clientId ?? null) : null,
		status,
		error: mine ? last.error : null
	};
};

/** A job a frame asked for and has not yet been told the outcome of. */
export interface TrackedJob {
	jobId: string;
	kind: FrameJobKind;
	/** Consecutive snapshots in which the job was in neither `running` nor `last`. */
	misses: number;
}

/** How many such snapshots in a row before the job is called `unknown`. */
export const UNKNOWN_AFTER_MISSES = 2;

/**
 * Settle every tracked job against one snapshot. A job that is the last of
 * its kind settles at once with the server's status. One that is simply
 * absent may be a stale poll — a GET that left before the PUT and landed
 * after startJob's optimistic row, overwriting it — so absence counts as
 * `unknown` only on the second consecutive snapshot; seeing it running
 * again resets the count.
 */
export const settleTracked = (
	snap: JobsSnapshot,
	tracked: readonly TrackedJob[]
): { messages: NonNullable<ReturnType<typeof finishedMessage>>[]; tracked: TrackedJob[] } => {
	const messages: NonNullable<ReturnType<typeof finishedMessage>>[] = [];
	const still: TrackedJob[] = [];
	for (const t of tracked) {
		const msg = finishedMessage(snap, t.jobId, t.kind);
		if (!msg) {
			still.push({ ...t, misses: 0 });
		} else if (msg.status !== 'unknown') {
			messages.push(msg);
		} else if (t.misses + 1 >= UNKNOWN_AFTER_MISSES) {
			messages.push(msg);
		} else {
			still.push({ ...t, misses: t.misses + 1 });
		}
	}
	return { messages, tracked: still };
};
