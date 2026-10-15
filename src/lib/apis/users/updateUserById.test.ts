import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateUserById } from './index';

describe('updateUserById', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('sends xplan_access so the admin switch is saved', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
		vi.stubGlobal('fetch', fetchMock);
		await updateUserById('t', 'u1', {
			role: 'user', profile_image_url: '', email: 'a@b.c', name: 'A', password: '', xplan_access: true
		});
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ xplan_access: true });
	});

	it('omits it when the caller did not set it', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
		vi.stubGlobal('fetch', fetchMock);
		await updateUserById('t', 'u1', { role: 'user', profile_image_url: '', email: 'a@b.c', name: 'A', password: '' });
		expect('xplan_access' in JSON.parse(fetchMock.mock.calls[0][1].body)).toBe(false);
	});
});
