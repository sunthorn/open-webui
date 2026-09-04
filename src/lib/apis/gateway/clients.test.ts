import { describe, it, expect, vi, afterEach } from 'vitest';
import { listAllClients } from './index';

/**
 * The Clients page used to make ONE request and take whatever came back. The
 * store caps `limit` at 1000 and the book is 4817, so it silently showed the
 * first page — indistinguishable from a small firm — and left the sweep's
 * refuse-to-shrink guard comparing a full sweep against a fraction of the
 * book, which is to say guarding nothing.
 */

const PAGE = 1000;

function stubBook(total: number, opts: { withTotal?: boolean } = {}) {
	const calls: { limit: string | null; offset: string | null }[] = [];

	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			const params = new URL(url, 'http://localhost').searchParams;
			calls.push({ limit: params.get('limit'), offset: params.get('offset') });
			const offset = Number(params.get('offset') ?? 0);
			const limit = Number(params.get('limit') ?? PAGE);
			const clients = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => ({
				xplanClientId: String(900000 + offset + i),
				xplanHouseholdId: null,
				name: `Paged, Client ${offset + i}`,
				syncedAt: '2026-09-01T00:00:00Z',
				deepSyncedAt: null
			}));
			return {
				ok: true,
				json: async () => ({
					clients,
					count: clients.length,
					...(opts.withTotal === false ? {} : { total })
				})
			};
		})
	);

	return calls;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('listAllClients — the whole book, not the first page of it', () => {
	it('pages until every row is collected', async () => {
		stubBook(4817);
		const res = await listAllClients('token');
		expect(res.clients).toHaveLength(4817);
		expect(res.total).toBe(4817);
	});

	it('collects each row exactly once, in order', async () => {
		stubBook(2500);
		const res = await listAllClients('token');
		const ids = res.clients.map((c) => c.xplanClientId);
		expect(new Set(ids).size).toBe(2500);
		expect(ids[0]).toBe('900000');
		expect(ids[2499]).toBe('902499');
	});

	it('advances offset by what it has, so no page is re-read', async () => {
		const calls = stubBook(2500);
		await listAllClients('token');
		expect(calls.map((c) => c.offset)).toEqual(['0', '1000', '2000']);
		expect(calls.every((c) => c.limit === String(PAGE))).toBe(true);
	});

	it('stops on `total` rather than fetching an extra empty page', async () => {
		const calls = stubBook(2000);
		await listAllClients('token');
		// 2000 rows is an exact two pages: a loop that only stopped on a short
		// page would spend a third request to learn it was done.
		expect(calls).toHaveLength(2);
	});

	it('still terminates when the gateway sends no `total`', async () => {
		const calls = stubBook(2000, { withTotal: false });
		const res = await listAllClients('token');
		expect(res.clients).toHaveLength(2000);
		expect(calls).toHaveLength(3); // two full pages, then a short one
	});

	it('a single short page is the whole book', async () => {
		const calls = stubBook(12);
		const res = await listAllClients('token');
		expect(res.clients).toHaveLength(12);
		expect(calls).toHaveLength(1);
	});
});
