// The running-sync store — one per app, read by every page.
//
// This replaces four component-local `syncing` flags and four
// AbortControllers. That was the bug: the work never died when you navigated
// away, only the UI around it did, so the page you came back to showed no
// spinner, no progress, and a button happy to start a second run.
//
// Nothing here owns a job. The server does. This is a view of what the server
// says is happening, refreshed while anything is in flight and stopped
// entirely when nothing is.
import { writable, get } from 'svelte/store';
import {
	cancelSyncJob,
	getSyncJobs,
	startSyncJob,
	EMPTY_SNAPSHOT,
	WORKER_SILENT_MS,
	type JobsSnapshot,
	type SyncJob,
	type SyncJobKind
} from '$lib/apis/gateway/jobs';

/** Every 2s while something runs. Not a websocket — a briefing is one status
 *  change every ~120s, and the poll costs one small request. */
export const POLL_MS = 2000;

/** A briefing older than this is refreshed on launch (design §7). */
export const BRIEFING_STALE_HOURS = 12;

export const syncJobs = writable<JobsSnapshot>(EMPTY_SNAPSHOT);

/** The last poll or start failure. Null once anything succeeds again. */
export const syncJobsError = writable<string | null>(null);

let timer: ReturnType<typeof setTimeout> | null = null;
let polling = false;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The job of this kind that is queued or running, if any. */
export const runningJob = (
	snap: JobsSnapshot,
	kind: SyncJobKind,
	clientId?: string
): SyncJob | undefined =>
	snap.running.find(
		(j) =>
			j.kind === kind &&
			// Deep syncs are per client — two clients are two jobs, and matching
			// on kind alone would put a spinner on the wrong client's page.
			(kind !== 'deep_sync' || j.params?.clientId === clientId)
	);

/**
 * Is this stamp older than `hours`?
 *
 * Never-run and unparseable both count as stale. Erring towards one extra
 * refresh costs seconds; erring the other way leaves the planner reading
 * yesterday's briefing believing it is today's.
 */
export const isStale = (
	iso: string | null | undefined,
	hours: number,
	now: Date = new Date()
): boolean => {
	if (!iso) return true;
	const t = new Date(iso).getTime();
	if (Number.isNaN(t)) return true;
	return now.getTime() - t > hours * 3600_000;
};

/** One poll, now. Keeps the last good snapshot if it fails. */
export const refreshJobs = async (token: string): Promise<void> => {
	try {
		syncJobs.set(await getSyncJobs(token));
		syncJobsError.set(null);
	} catch (e) {
		// Deliberately NOT clearing the snapshot. A gateway blip that emptied
		// it would take a running job off the top bar, which reads as "it
		// finished" — the opposite of what happened.
		syncJobsError.set(message(e));
	}
};

const tick = async (token: string): Promise<void> => {
	await refreshJobs(token);
	if (!polling) return;
	if (get(syncJobs).running.length === 0) {
		// Idle: stop completely rather than spinning a timer forever. The next
		// start() wakes it back up.
		polling = false;
		timer = null;
		return;
	}
	timer = setTimeout(() => void tick(token), POLL_MS);
};

/** Poll while anything is running. Safe to call repeatedly. */
export const startJobPolling = async (token: string): Promise<void> => {
	if (polling) return;
	polling = true;
	await tick(token);
};

export const stopJobPolling = (): void => {
	polling = false;
	if (timer) clearTimeout(timer);
	timer = null;
};

/**
 * Queue a sync and show it at once.
 *
 * Waiting for the next poll would leave two seconds of dead button after a
 * click, which is how a planner learns to click twice. A `running` status
 * back from the gateway means a job was already going and we adopted it —
 * not an error.
 */
export const startJob = async (
	token: string,
	kind: SyncJobKind,
	params: { clientId?: string } = {}
): Promise<SyncJob | null> => {
	try {
		const { jobId, status } = await startSyncJob(token, kind, params);
		const optimistic: SyncJob = {
			id: jobId,
			kind,
			status,
			trigger: 'manual',
			params: params.clientId ? { clientId: params.clientId } : {},
			createdAt: new Date().toISOString(),
			startedAt: null,
			finishedAt: null,
			error: null,
			resultKey: null,
			progress: null
		};
		syncJobs.update((s) =>
			s.running.some((j) => j.id === jobId)
				? s
				: { ...s, running: [...s.running, optimistic] }
		);
		syncJobsError.set(null);
		void startJobPolling(token);
		return optimistic;
	} catch (e) {
		syncJobsError.set(message(e));
		return null;
	}
};

/** Ask the worker to stop. Server-side, so this works from any tab or device. */
export const stopJob = async (token: string, jobId: string): Promise<void> => {
	try {
		await cancelSyncJob(token, jobId);
	} catch (e) {
		syncJobsError.set(message(e));
	}
	await refreshJobs(token);
};

/**
 * How long this run has been going, for the top-bar indicator.
 *
 * A queued job has no `startedAt` and must say so — "0s" would claim it is
 * running when no worker has picked it up. Once it has been queued for five
 * minutes, say why nothing is happening: a stopped worker is otherwise an
 * infinite spinner with nothing on screen naming the actual problem.
 *
 * Clamped at zero because the stamp is the server's, and a browser a few
 * seconds behind would otherwise render "-3s" — which reads as a bug in the
 * sync rather than in the clocks.
 */
export const elapsedLabel = (
	startedAt: string | null,
	now: Date = new Date(),
	createdAt: string | null = null
): string => {
	if (!startedAt) {
		const asked = createdAt ? new Date(createdAt).getTime() : NaN;
		if (!Number.isNaN(asked) && now.getTime() - asked > WORKER_SILENT_MS) {
			return 'queued — the worker may be down';
		}
		return 'queued';
	}
	const t = new Date(startedAt).getTime();
	if (Number.isNaN(t)) return 'queued';
	const secs = Math.max(0, Math.floor((now.getTime() - t) / 1000));
	return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
};

/**
 * Start a run for any kind whose last SUCCESS is older than the window.
 *
 * This is what "run on a schedule" turned into. What a planner wants is a
 * briefing that is ready when they open axi, not one compiled at 3am against
 * an XPLAN session that expired overnight — and this needs no scheduler, so
 * it cannot double-fire from two beat containers.
 *
 * Called once per session from the apps layout. Deliberately quiet: it starts
 * nothing if a run is already going (a second tab must not queue a second
 * ~120s agent call), and nothing at all if the job list could not be read,
 * because a failed poll says nothing about staleness.
 */
export const maybeStartStale = async (
	token: string,
	kinds: SyncJobKind[] = ['briefing']
): Promise<void> => {
	await refreshJobs(token);
	if (get(syncJobsError)) return;
	const snap = get(syncJobs);
	for (const kind of kinds) {
		if (runningJob(snap, kind)) continue;
		if (!isStale(snap.lastSuccessAt[kind], BRIEFING_STALE_HOURS)) continue;
		await startJob(token, kind);
	}
};
