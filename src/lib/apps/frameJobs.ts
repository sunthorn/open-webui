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
