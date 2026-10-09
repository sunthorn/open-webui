import { describe, it, expect } from 'vitest';
import { finishedMessage, parseFrameRequest, startedMessage } from './frameJobs';
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
