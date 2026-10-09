import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	STAGES,
	getOnboarding,
	setAction,
	setStage,
	runAction,
	getActivity,
	listLeads
} from './onboarding';
import { STAGES as CONTRACT } from '../../../../../shared-contracts/types/onboarding';
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

describe('STAGES', () => {
	it('mirrors shared-contracts/types/onboarding.ts exactly', () => {
		// Hand-synced until shared-contracts is in the build context; this is
		// the check that the two cannot drift.
		expect(STAGES).toEqual(CONTRACT);
	});
});

describe('onboarding gateway client', () => {
	it('getOnboarding reads the lead, actions and drive state', async () => {
		const calls = stub(200, {
			lead: { stage: 'enquiry' },
			actions: [],
			drive: { connected: true }
		});
		const s = await getOnboarding(TOKEN, '899317');
		expect(s.drive.connected).toBe(true);
		expect(calls[0].url).toBe('/gw/onboarding/899317');
	});

	it('setStage PUTs the stage', async () => {
		const calls = stub(200, { lead: { stage: 'discovery' }, actions: [] });
		await setStage(TOKEN, '899317', 'discovery');
		expect(calls[0].url).toBe('/gw/onboarding/899317/stage');
		expect(calls[0].init.method).toBe('PUT');
		expect(JSON.parse(String(calls[0].init.body))).toEqual({ stage: 'discovery' });
	});

	it('setAction PUTs done|pending and unwraps the action', async () => {
		const calls = stub(200, { action: { step: 'enquiry.fsg', status: 'done' } });
		const a = await setAction(TOKEN, '899317', 'enquiry.fsg', 'done');
		expect(a.status).toBe('done');
		expect(calls[0].url).toBe('/gw/onboarding/899317/actions/enquiry.fsg');
		expect(JSON.parse(String(calls[0].init.body))).toEqual({ status: 'done' });
	});

	it('runAction POSTs kind and args and returns the job id', async () => {
		const calls = stub(200, { jobId: 'j1', status: 'queued' });
		const out = await runAction(TOKEN, '899317', 'enquiry.discovery_meeting', 'onb_book', {
			slot: { start: 's' }
		});
		expect(out).toEqual({ jobId: 'j1', status: 'queued' });
		expect(calls[0].url).toBe('/gw/onboarding/899317/actions/enquiry.discovery_meeting/run');
		expect(JSON.parse(String(calls[0].init.body))).toEqual({
			kind: 'onb_book',
			args: { slot: { start: 's' } }
		});
	});

	it('a 409 gate surfaces as a GatewayError carrying the detail', async () => {
		stub(409, { detail: 'draft it first' });
		await expect(runAction(TOKEN, '899317', 'enquiry.fsg', 'onb_send')).rejects.toMatchObject({
			name: 'GatewayError',
			status: 409,
			message: 'draft it first'
		});
	});

	it('getActivity and listLeads unwrap their arrays', async () => {
		stub(200, { activity: [{ event: 'sent' }] });
		expect(await getActivity(TOKEN, '899317')).toEqual([{ event: 'sent' }]);
		const calls = stub(200, { leads: [{ xplanClientId: '1' }] });
		expect(await listLeads(TOKEN, 'enquiry')).toEqual([{ xplanClientId: '1' }]);
		expect(calls[0].url).toBe('/gw/onboarding?stage=enquiry');
		await listLeads(TOKEN);
		expect(calls[1].url).toBe('/gw/onboarding');
	});
});

describe('setAction with notes', () => {
	it('sends notes alone when status is null — a save, not an untick', async () => {
		const calls = stub(200, { action: { step: 'discovery.clarify_goals', status: 'ready' } });
		await setAction(TOKEN, '899317', 'discovery.clarify_goals', null, { notes: 'ask about SMSF' });
		expect(calls[0].url).toBe('/gw/onboarding/899317/actions/discovery.clarify_goals');
		expect(JSON.parse(String(calls[0].init.body))).toEqual({ detail: { notes: 'ask about SMSF' } });
	});

	it('sends status and notes together when both are given', async () => {
		const calls = stub(200, { action: {} });
		await setAction(TOKEN, '899317', 'discovery.clarify_goals', 'done', { notes: 'n' });
		expect(JSON.parse(String(calls[0].init.body))).toEqual({ status: 'done', detail: { notes: 'n' } });
	});

	it('sends no detail for a plain tick', async () => {
		const calls = stub(200, { action: {} });
		await setAction(TOKEN, '899317', 'data_entry.gather_missing', 'done');
		expect(JSON.parse(String(calls[0].init.body))).toEqual({ status: 'done' });
	});
});
