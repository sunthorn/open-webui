import { describe, it, expect, vi, afterEach } from 'vitest';
import { startSyncJob, getSyncJobs, cancelSyncJob, EMPTY_SNAPSHOT } from './jobs';
import { GatewayError } from './index';

const TOKEN = 'tok';

const stub = (status: number, body: unknown) => {
	const calls: { url: string; init: RequestInit }[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			return {
				ok: status >= 200 && status < 300,
				status,
				json: async () => body
			} as unknown as Response;
		})
	);
	return calls;
};

afterEach(() => vi.unstubAllGlobals());

describe('startSyncJob', () => {
	it('PUTs the kind and returns the job id', async () => {
		const calls = stub(200, { jobId: 'j1', status: 'queued' });
		const out = await startSyncJob(TOKEN, 'book_sync');
		expect(out).toEqual({ jobId: 'j1', status: 'queued' });
		expect(calls[0].url).toBe('/gw/jobs/book_sync');
		expect(calls[0].init.method).toBe('PUT');
	});

	it('sends clientId for a deep sync', async () => {
		const calls = stub(200, { jobId: 'j2', status: 'queued' });
		await startSyncJob(TOKEN, 'deep_sync', { clientId: '724142' });
		expect(JSON.parse(String(calls[0].init.body))).toEqual({ clientId: '724142' });
	});

	it('returns the RUNNING job when one is already going', async () => {
		// The server answers a duplicate click with 200 and the live job's id.
		// This is not an error the UI should report — it is "watch that one".
		stub(200, { jobId: 'j1', status: 'running' });
		expect(await startSyncJob(TOKEN, 'book_sync')).toEqual({
			jobId: 'j1',
			status: 'running'
		});
	});

	it('surfaces a locked guardrail as a GatewayError carrying 403', async () => {
		// The caller needs the STATUS, not just the words: 403 means "change
		// the access tier", 503 means "sign in to XPLAN again". Two different
		// next steps for the planner.
		stub(403, { detail: 'xplan access is locked' });
		await expect(startSyncJob(TOKEN, 'book_sync')).rejects.toMatchObject({
			status: 403,
			message: 'xplan access is locked'
		});
	});

	it('surfaces an unavailable queue as 503', async () => {
		stub(503, { detail: 'job queue unavailable' });
		const err = await startSyncJob(TOKEN, 'briefing').catch((e) => e);
		expect(err).toBeInstanceOf(GatewayError);
		expect(err.status).toBe(503);
	});
});

describe('getSyncJobs', () => {
	it('returns running work, the last run and the last success', async () => {
		stub(200, {
			running: [{ id: 'j1', kind: 'briefing', status: 'running', progress: 'page 4 of 8' }],
			last: { book_sync: { id: 'j0', status: 'error', error: 'XPLAN returned no clients' } },
			lastSuccessAt: { book_sync: '2026-09-05T08:00:00+00:00' }
		});
		const snap = await getSyncJobs(TOKEN);
		expect(snap.running[0].progress).toBe('page 4 of 8');
		expect(snap.last.book_sync?.error).toBe('XPLAN returned no clients');
		expect(snap.lastSuccessAt.book_sync).toBe('2026-09-05T08:00:00+00:00');
	});

	it('fills in the missing halves rather than handing back undefined', async () => {
		// A caller reading `snap.last.briefing` must not have to guard against
		// `snap.last` itself being undefined on every single access.
		stub(200, { running: [] });
		const snap = await getSyncJobs(TOKEN);
		expect(snap.last).toEqual({});
		expect(snap.lastSuccessAt).toEqual({});
	});

	it('throws on a failed poll rather than reporting an empty snapshot', async () => {
		// An empty snapshot means "nothing is running", which would silently
		// hide a job that IS running behind a gateway blip.
		stub(503, { detail: 'job queue unavailable' });
		await expect(getSyncJobs(TOKEN)).rejects.toBeInstanceOf(GatewayError);
	});
});

describe('cancelSyncJob', () => {
	it('PUTs to the job cancel path', async () => {
		const calls = stub(200, { ok: true });
		await cancelSyncJob(TOKEN, 'j1');
		expect(calls[0].url).toBe('/gw/jobs/j1/cancel');
		expect(calls[0].init.method).toBe('PUT');
	});

	it('throws when the gateway refuses', async () => {
		stub(503, { detail: 'job queue unavailable' });
		await expect(cancelSyncJob(TOKEN, 'j1')).rejects.toBeInstanceOf(GatewayError);
	});
});

describe('EMPTY_SNAPSHOT', () => {
	it('is a usable snapshot, so nothing has to null-check the store', () => {
		expect(EMPTY_SNAPSHOT.running).toEqual([]);
		expect(EMPTY_SNAPSHOT.last).toEqual({});
		expect(EMPTY_SNAPSHOT.lastSuccessAt).toEqual({});
	});
});
