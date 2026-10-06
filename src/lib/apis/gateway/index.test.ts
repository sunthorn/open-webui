import { describe, it, expect, vi } from 'vitest';
import { downloadXplanHelper, disconnectXplanHelper } from './index';

describe('downloadXplanHelper', () => {
	it('GETs the zip for the OS with the bearer and returns the blob', async () => {
		const blob = new Blob(['zip']);
		const fetchFn = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob });
		expect(await downloadXplanHelper('tok', 'win', fetchFn)).toBe(blob);
		expect(fetchFn).toHaveBeenCalledWith('/gw/xplan/helper?os=win', {
			headers: { Authorization: 'Bearer tok' }
		});
	});
	it('throws the gateway detail on failure', async () => {
		const fetchFn = vi.fn().mockResolvedValue({
			ok: false, status: 404, json: async () => ({ detail: 'helper download is not enabled' })
		});
		await expect(downloadXplanHelper('tok', 'mac', fetchFn)).rejects.toThrow('helper download is not enabled');
	});
});

describe('disconnectXplanHelper', () => {
	it('DELETEs and reports whether a token existed', async () => {
		const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ deleted: true }) });
		expect(await disconnectXplanHelper('tok', fetchFn)).toBe(true);
		expect(fetchFn).toHaveBeenCalledWith('/gw/xplan/helper', {
			method: 'DELETE', headers: { Authorization: 'Bearer tok' }
		});
	});
});
