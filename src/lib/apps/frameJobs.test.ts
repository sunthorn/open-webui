import { describe, it, expect } from 'vitest';
import {
	finishedMessage,
	fromOurFrame,
	needsFollowUp,
	parseFrameRequest,
	settleTracked,
	startedMessage
} from './frameJobs';
import { EMPTY_SNAPSHOT, type SyncJob } from '$lib/apis/gateway/jobs';

const job = (over: Partial<SyncJob>): SyncJob => ({
	id: 'j1', kind: 'profile_fill', status: 'done', trigger: 'manual', params: { client: '899317' },
	createdAt: null, startedAt: null, finishedAt: null, error: null, resultKey: null, progress: null, ...over
});

describe('parseFrameRequest', () => {
	it('accepts a well-formed profile_fill request', () => {
		expect(parseFrameRequest({ axi: 'run-job', kind: 'profile_fill', clientId: '899317', requestId: 'profile_fill-1-1' }))
			.toEqual({ kind: 'profile_fill', clientId: '899317', requestId: 'profile_fill-1-1' });
	});
	it('ignores kinds outside the allowlist and malformed ids', () => {
		expect(parseFrameRequest({ axi: 'run-job', kind: 'book_sync', clientId: '1', requestId: 'r' })).toBeNull();
		expect(parseFrameRequest({ axi: 'run-job', kind: 'profile_fill', clientId: '../x', requestId: 'r' })).toBeNull();
		expect(parseFrameRequest({ axi: 'run-job', kind: 'profile_fill', clientId: '1', requestId: 'has space' })).toBeNull();
		expect(parseFrameRequest({ axi: 'job', kind: 'profile_fill', clientId: '1', requestId: 'r' })).toBeNull();
		expect(parseFrameRequest('run-job')).toBeNull();
		expect(parseFrameRequest(null)).toBeNull();
	});
});

describe('startedMessage', () => {
	it('names the job, or says why there is none', () => {
		expect(startedMessage('r1', job({ status: 'queued' }), null)).toEqual({ axi: 'job', requestId: 'r1', jobId: 'j1', status: 'queued' });
		expect(startedMessage('r1', null, 'XPLAN access is locked')).toEqual({ axi: 'job', requestId: 'r1', jobId: null, status: 'error', error: 'XPLAN access is locked' });
	});
});

describe('finishedMessage', () => {
	it('is null while the job is still queued or running', () => {
		const snap = { ...EMPTY_SNAPSHOT, running: [job({ status: 'running' })] };
		expect(finishedMessage(snap, 'j1', 'profile_fill')).toBeNull();
	});
	it('reports the terminal status and error once the job is the last of its kind', () => {
		const snap = { ...EMPTY_SNAPSHOT, last: { profile_fill: job({ status: 'error', error: 'finny refused: no access' }) } };
		expect(finishedMessage(snap, 'j1', 'profile_fill')).toEqual({
			axi: 'job-finished', jobId: 'j1', kind: 'profile_fill', clientId: '899317', status: 'error', error: 'finny refused: no access'
		});
	});
	it('says unknown when the job vanished without becoming the last of its kind', () => {
		const snap = { ...EMPTY_SNAPSHOT, last: { profile_fill: job({ id: 'j2' }) } };
		expect(finishedMessage(snap, 'j1', 'profile_fill')).toMatchObject({ axi: 'job-finished', jobId: 'j1', status: 'unknown' });
	});
});

describe('settleTracked', () => {
	const t = { jobId: 'j1', kind: 'profile_fill' as const, misses: 0 };

	it('waits one stale snapshot before calling a missing job unknown', () => {
		// A poll that left before the PUT can land after it and drop the
		// optimistic row: one absence is not a vanished job.
		const stale = { ...EMPTY_SNAPSHOT };
		const first = settleTracked(stale, [t]);
		expect(first.messages).toEqual([]);
		expect(first.tracked).toEqual([{ ...t, misses: 1 }]);
		const second = settleTracked(stale, first.tracked);
		expect(second.messages).toEqual([expect.objectContaining({ jobId: 'j1', status: 'unknown' })]);
		expect(second.tracked).toEqual([]);
	});
	it('resets the count when the job shows up running again', () => {
		const running = { ...EMPTY_SNAPSHOT, running: [job({ status: 'running' })] };
		expect(settleTracked(running, [{ ...t, misses: 1 }])).toEqual({ messages: [], tracked: [t] });
	});
	it('settles at once when the job is the last of its kind', () => {
		const done = { ...EMPTY_SNAPSHOT, last: { profile_fill: job({ status: 'done' }) } };
		const r = settleTracked(done, [t]);
		expect(r.messages).toEqual([expect.objectContaining({ jobId: 'j1', status: 'done' })]);
		expect(r.tracked).toEqual([]);
	});
});

describe('fromOurFrame', () => {
	const o = 'https://axi.test';
	it('accepts only finny, from its own frame, on this origin', () => {
		expect(fromOurFrame('finny', o, o, true)).toBe(true);
		expect(fromOurFrame('salem', o, o, true)).toBe(false);
		expect(fromOurFrame('finny', 'https://evil.test', o, true)).toBe(false);
		expect(fromOurFrame('finny', o, o, false)).toBe(false);
		expect(fromOurFrame(undefined, o, o, true)).toBe(false);
	});
});

describe('needsFollowUp', () => {
	const running = { jobId: 'j1', kind: 'profile_fill' as const, misses: 0 };
	const missed = { ...running, misses: 1 };
	it('follows up a job with a miss, even when the store has stopped polling', () => {
		expect(needsFollowUp([missed], false)).toBe(true);
		expect(needsFollowUp([running, missed], false)).toBe(true);
	});
	it('leaves a job still seen running to the store poller', () => {
		expect(needsFollowUp([running], false)).toBe(false);
	});
	it('retries a failed GET while anything is tracked', () => {
		expect(needsFollowUp([running], true)).toBe(true);
		expect(needsFollowUp([missed], true)).toBe(true);
	});
	it('stops once nothing is tracked', () => {
		expect(needsFollowUp([], false)).toBe(false);
		expect(needsFollowUp([], true)).toBe(false);
	});
});
