import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { activeClient, linkableClientId, sanitizeStored, type ActiveClient } from './activeClient';

const client = (over: Partial<ActiveClient> = {}): ActiveClient => ({
	id: '899317',
	name: 'Kongsakprasert, Sunthorn',
	since: '2026-09-09T00:00:00.000Z',
	...over
});

describe('linkableClientId', () => {
	beforeEach(() => activeClient.set(null));

	it('is the XPLAN id of the active client', () => {
		activeClient.set(client());
		expect(get(linkableClientId)).toBe('899317');
	});
	it('is null when no client is selected', () => {
		expect(get(linkableClientId)).toBe(null);
	});
	it('is null for an empty or whitespace id', () => {
		activeClient.set(client({ id: '   ' }));
		expect(get(linkableClientId)).toBe(null);
	});
	it('is trimmed', () => {
		activeClient.set(client({ id: ' 899317 ' }));
		expect(get(linkableClientId)).toBe('899317');
	});
});

describe('sanitizeStored', () => {
	it('rejects a lead id left over from the old mode field', () => {
		// Review Focus 5: localStorage written by the previous release.
		const stale = [
			{ id: 'new:Jane Doe', name: 'Jane Doe', mode: 'new', since: 's' },
			{ id: 'lead-abc123', name: 'Jo', mode: 'new', since: 's' },
			{ id: '899317', name: 'Real', mode: 'existing', since: 's' }
		];
		expect(sanitizeStored(stale)).toEqual([{ id: '899317', name: 'Real', since: 's' }]);
	});
	it('drops junk shapes and blank ids', () => {
		expect(sanitizeStored([null, 'x', { id: '', name: 'n', since: 's' }, { name: 'no id' }])).toEqual([]);
	});
});
