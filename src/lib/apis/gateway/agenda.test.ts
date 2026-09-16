import { describe, it, expect, vi, afterEach } from 'vitest';
import { getAgenda, getConnectors, authorizeConnector, disconnectConnector, isoDate } from './agenda';
import { GatewayError } from './index';

const stub = (status: number, body: unknown) => {
	const calls: { url: string; init: RequestInit }[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			return { ok: status < 300, status, json: async () => body } as unknown as Response;
		})
	);
	return calls;
};
afterEach(() => vi.unstubAllGlobals());

describe('getAgenda', () => {
	it('GETs the window and passes refresh only when asked', async () => {
		const calls = stub(200, { events: [], tasks: [], sources: {} });
		await getAgenda('tok', '2026-09-14', '2026-09-20');
		expect(calls[0].url).toBe('/gw/agenda?from=2026-09-14&to=2026-09-20');
		expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
		await getAgenda('tok', '2026-09-14', '2026-09-20', true);
		expect(calls[1].url).toBe('/gw/agenda?from=2026-09-14&to=2026-09-20&refresh=1');
	});

	it('throws a GatewayError with the status on failure', async () => {
		stub(400, { detail: 'window must be 0–31 days' });
		await expect(getAgenda('tok', 'a', 'b')).rejects.toMatchObject({ status: 400, message: 'window must be 0–31 days' });
	});
});

describe('connectors', () => {
	it('reads status per provider', async () => {
		stub(200, { m365: { status: 'ok', email: 's@firm.au' }, google: { status: 'disconnected' } });
		const out = await getConnectors('tok');
		expect(out.google.status).toBe('disconnected');
	});

	it('authorize returns the URL to navigate to', async () => {
		const calls = stub(200, { url: 'https://consent' });
		expect(await authorizeConnector('tok', 'google')).toBe('https://consent');
		expect(calls[0].url).toBe('/gw/connectors/google/authorize');
	});

	it('disconnect uses DELETE', async () => {
		const calls = stub(200, { disconnected: true });
		expect(await disconnectConnector('tok', 'm365')).toBe(true);
		expect(calls[0].init.method).toBe('DELETE');
		expect(calls[0].url).toBe('/gw/connectors/m365');
	});
});

describe('isoDate', () => {
	it('formats the LOCAL calendar date', () => {
		expect(isoDate(new Date(2026, 8, 14, 23, 30))).toBe('2026-09-14');
		expect(isoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
	});
});
