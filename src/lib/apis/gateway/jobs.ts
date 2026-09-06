// Background sync jobs — the browser starts work and then forgets about it.
//
// Every long XPLAN sync runs on axi's worker, not in this tab. That is the
// whole point: a run survives navigating away, a reload, and closing the
// browser. Nothing here holds an AbortController, because nothing here owns
// the work — the server does, which is also why Stop keeps working from a
// different tab or a phone.
//
// Contract: shared-contracts/sync-jobs-spec.md
// Design:   docs/superpowers/specs/2026-09-06-sync-jobs-design.md
import { gatewayError, gatewayUrl } from './index';

export type SyncJobKind = 'book_sync' | 'deep_sync' | 'briefing' | 'overview';

export type SyncJobStatus =
	| 'queued'
	| 'running'
	| 'done'
	| 'error'
	/** Stop was pressed. Whatever was already written stays written. */
	| 'cancelled'
	/**
	 * We did not look — XPLAN signed out, or access is locked. NOT an error,
	 * and never a success: "we did not look" must not read as "nothing found".
	 */
	| 'skipped';

export interface SyncJob {
	id: string;
	kind: SyncJobKind;
	status: SyncJobStatus;
	trigger: 'manual' | 'launch' | 'schedule';
	params: Record<string, string>;
	/** When it was asked for. */
	createdAt: string | null;
	/** When a worker picked it up. Null while queued — and a `createdAt` with
	 *  no `startedAt`, minutes old, is how the UI spots a dead worker. */
	startedAt: string | null;
	finishedAt: string | null;
	error: string | null;
	resultKey: string | null;
	/** Live, from Redis. Null when the worker has not said anything yet. */
	progress: string | null;
}

/** A job still queued after this long has nothing picking it up (design §8). */
export const WORKER_SILENT_MS = 5 * 60_000;

export interface JobsSnapshot {
	/** Queued and running, oldest first. */
	running: SyncJob[];
	/** Per kind, the last run that FINISHED — whatever its status. Read this for
	 *  the error text of whatever just failed. */
	last: Partial<Record<SyncJobKind, SyncJob>>;
	/** Per kind, when it last actually succeeded. Read this for staleness. The
	 *  two differ exactly when the latest run failed, which is when both matter. */
	lastSuccessAt: Partial<Record<SyncJobKind, string>>;
}

export const EMPTY_SNAPSHOT: JobsSnapshot = { running: [], last: {}, lastSuccessAt: {} };

/** What the running-job indicator calls each kind. */
export const KIND_LABEL: Record<SyncJobKind, string> = {
	book_sync: 'Client book',
	deep_sync: 'Client sync',
	briefing: 'Briefing',
	overview: 'Overview'
};

const auth = (token: string) => ({
	Authorization: `Bearer ${token}`,
	'Content-Type': 'application/json'
});

/**
 * Queue one sync. Returns as soon as the row exists — the work has not run yet.
 *
 * A second call while one is going returns the RUNNING job's id with status
 * `running`, not an error: there is no 409 anywhere in this API. Callers should
 * treat that as "watch this one" and not as a failed click.
 */
export const startSyncJob = async (
	token: string,
	kind: SyncJobKind,
	params: { clientId?: string } = {}
): Promise<{ jobId: string; status: SyncJobStatus }> => {
	const res = await fetch(`${gatewayUrl()}/gw/jobs/${kind}`, {
		method: 'PUT',
		headers: auth(token),
		body: JSON.stringify(params)
	});
	if (!res.ok) throw await gatewayError(res);
	return await res.json();
};

/** One poll, carrying every answer the UI needs. */
export const getSyncJobs = async (token: string): Promise<JobsSnapshot> => {
	const res = await fetch(`${gatewayUrl()}/gw/jobs`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (!res.ok) throw await gatewayError(res);
	const body = await res.json();
	// Fill the halves in rather than handing back undefined — every caller
	// reads `snap.last.briefing`, and guarding that on each access is how a
	// missing key becomes a crash on a page the planner is looking at.
	return {
		running: body?.running ?? [],
		last: body?.last ?? {},
		lastSuccessAt: body?.lastSuccessAt ?? {}
	};
};

/** Ask the worker to stop at its next safe point. Server-side, so any tab works. */
export const cancelSyncJob = async (token: string, jobId: string): Promise<void> => {
	const res = await fetch(`${gatewayUrl()}/gw/jobs/${jobId}/cancel`, {
		method: 'PUT',
		headers: auth(token)
	});
	if (!res.ok) throw await gatewayError(res);
};
