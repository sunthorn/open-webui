import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import * as api from '$lib/apis/gateway/jobs';
import {
	syncJobs,
	syncJobsError,
	startJobPolling,
	stopJobPolling,
	refreshJobs,
	startJob,
	stopJob,
	runningJob,
	isStale,
	elapsedLabel,
	POLL_MS
} from './syncJobs';

const job = (over: Partial<api.SyncJob> = {}): api.SyncJob => ({
	id: 'j1',
	kind: 'briefing',
	status: 'running',
	trigger: 'manual',
	params: {},
	createdAt: '2026-09-06T08:00:00+00:00',
	startedAt: '2026-09-06T08:00:00+00:00',
	finishedAt: null,
	error: null,
	resultKey: null,
	progress: null,
	...over
});

beforeEach(() => {
	vi.useFakeTimers();
	syncJobs.set(api.EMPTY_SNAPSHOT);
	syncJobsError.set(null);
});

afterEach(() => {
	stopJobPolling();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('runningJob', () => {
	it('finds the job of a kind that is going', () => {
		const snap = { ...api.EMPTY_SNAPSHOT, running: [job({ kind: 'book_sync' })] };
		expect(runningJob(snap, 'book_sync')?.id).toBe('j1');
		expect(runningJob(snap, 'briefing')).toBeUndefined();
	});

	it('matches a deep sync on its client, not just its kind', () => {
		// Two clients syncing are two jobs. Matching on kind alone would put a
		// spinner on the wrong client's page.
		const snap = {
			...api.EMPTY_SNAPSHOT,
			running: [job({ id: 'a', kind: 'deep_sync', params: { clientId: '1' } })]
		};
		expect(runningJob(snap, 'deep_sync', '1')?.id).toBe('a');
		expect(runningJob(snap, 'deep_sync', '2')).toBeUndefined();
	});

	it('counts a queued job as running', () => {
		// It has not started, but it IS going to. Showing nothing until the
		// worker picks it up is the "did my click work?" gap all over again.
		const snap = { ...api.EMPTY_SNAPSHOT, running: [job({ status: 'queued' })] };
		expect(runningJob(snap, 'briefing')?.status).toBe('queued');
	});
});

describe('isStale', () => {
	const now = new Date('2026-09-06T12:00:00Z');

	it('treats never-run as stale', () => {
		expect(isStale(null, 12, now)).toBe(true);
		expect(isStale(undefined, 12, now)).toBe(true);
	});

	it('is false inside the window and true outside it', () => {
		expect(isStale('2026-09-06T06:00:00Z', 12, now)).toBe(false);
		expect(isStale('2026-09-05T18:00:00Z', 12, now)).toBe(true);
	});

	it('treats an unparseable stamp as stale', () => {
		// Erring towards a refresh costs one run; erring the other way leaves
		// the planner reading yesterday's briefing believing it is today's.
		expect(isStale('not a date', 12, now)).toBe(true);
	});
});

describe('polling', () => {
	it('polls once immediately and keeps going while work is running', async () => {
		const spy = vi
			.spyOn(api, 'getSyncJobs')
			.mockResolvedValue({ ...api.EMPTY_SNAPSHOT, running: [job()] });
		await startJobPolling('tok');
		expect(spy).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(POLL_MS);
		expect(spy).toHaveBeenCalledTimes(2);
	});

	it('stops entirely once nothing is running', async () => {
		// Not a websocket and not a forever-timer: a briefing is one status
		// change every ~120s, and an idle tab should cost nothing.
		const spy = vi.spyOn(api, 'getSyncJobs').mockResolvedValue(api.EMPTY_SNAPSHOT);
		await startJobPolling('tok');
		expect(spy).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(POLL_MS * 5);
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('never runs two loops at once', async () => {
		const spy = vi
			.spyOn(api, 'getSyncJobs')
			.mockResolvedValue({ ...api.EMPTY_SNAPSHOT, running: [job()] });
		await startJobPolling('tok');
		await startJobPolling('tok');
		spy.mockClear();
		await vi.advanceTimersByTimeAsync(POLL_MS);
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('keeps the last good snapshot when a poll fails', async () => {
		// A gateway blip must not make a running job disappear from the top
		// bar — that reads as "it finished", which is the opposite of true.
		const good = { ...api.EMPTY_SNAPSHOT, running: [job()] };
		const spy = vi.spyOn(api, 'getSyncJobs').mockResolvedValue(good);
		await startJobPolling('tok');
		spy.mockRejectedValue(new Error('gateway down'));
		await vi.advanceTimersByTimeAsync(POLL_MS);
		expect(get(syncJobs).running).toHaveLength(1);
		expect(get(syncJobsError)).toBe('gateway down');
	});

	it('clears the error once a poll succeeds again', async () => {
		const spy = vi.spyOn(api, 'getSyncJobs').mockRejectedValue(new Error('down'));
		await refreshJobs('tok');
		expect(get(syncJobsError)).toBe('down');
		spy.mockResolvedValue(api.EMPTY_SNAPSHOT);
		await refreshJobs('tok');
		expect(get(syncJobsError)).toBeNull();
	});
});

describe('startJob', () => {
	it('shows the job immediately instead of waiting for the next poll', async () => {
		// Two seconds of a dead button after a click is how a planner learns
		// to click twice.
		vi.spyOn(api, 'startSyncJob').mockResolvedValue({ jobId: 'j9', status: 'queued' });
		vi.spyOn(api, 'getSyncJobs').mockResolvedValue(api.EMPTY_SNAPSHOT);
		const started = await startJob('tok', 'book_sync');
		expect(started?.id).toBe('j9');
		expect(runningJob(get(syncJobs), 'book_sync')?.id).toBe('j9');
	});

	it('records why a start was refused and starts nothing', async () => {
		vi.spyOn(api, 'startSyncJob').mockRejectedValue(new Error('xplan access is locked'));
		expect(await startJob('tok', 'book_sync')).toBeNull();
		expect(get(syncJobsError)).toBe('xplan access is locked');
		expect(get(syncJobs).running).toEqual([]);
	});

	it('adopts a job that was already running', async () => {
		vi.spyOn(api, 'startSyncJob').mockResolvedValue({ jobId: 'j1', status: 'running' });
		vi.spyOn(api, 'getSyncJobs').mockResolvedValue(api.EMPTY_SNAPSHOT);
		const adopted = await startJob('tok', 'briefing');
		expect(adopted?.status).toBe('running');
	});
});

describe('stopJob', () => {
	it('cancels through the gateway and refreshes', async () => {
		const cancel = vi.spyOn(api, 'cancelSyncJob').mockResolvedValue(undefined);
		const poll = vi.spyOn(api, 'getSyncJobs').mockResolvedValue(api.EMPTY_SNAPSHOT);
		await stopJob('tok', 'j1');
		expect(cancel).toHaveBeenCalledWith('tok', 'j1');
		expect(poll).toHaveBeenCalled();
	});
});

describe('elapsedLabel', () => {
	const now = new Date('2026-09-06T12:01:12Z');

	it('reads as m s past the first minute', () => {
		expect(elapsedLabel('2026-09-06T12:00:00Z', now)).toBe('1m 12s');
	});

	it('reads as seconds only under a minute', () => {
		expect(elapsedLabel('2026-09-06T12:00:50Z', now)).toBe('22s');
	});

	it('says "queued" when nothing has started it yet', () => {
		// A queued job has no startedAt. "0s" would claim it is running.
		expect(elapsedLabel(null, now)).toBe('queued');
	});

	it('says the worker may be down once a job has waited five minutes', () => {
		// Design §8. Otherwise a stopped worker is an infinite spinner with
		// nothing on screen naming the actual problem.
		expect(elapsedLabel(null, now, '2026-09-06T11:50:00Z')).toBe(
			'queued — the worker may be down'
		);
	});

	it('does not accuse the worker while the wait is still normal', () => {
		expect(elapsedLabel(null, now, '2026-09-06T12:01:00Z')).toBe('queued');
	});

	it('never shows a negative age when the clocks disagree', () => {
		// The stamp comes from the server. A browser a few seconds behind must
		// not render "-3s", which reads as a bug in the sync.
		expect(elapsedLabel('2026-09-06T12:01:15Z', now)).toBe('0s');
	});
});
