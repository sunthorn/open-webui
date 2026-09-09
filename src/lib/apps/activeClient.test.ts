import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { activeClient, linkableClientId, type ActiveClient } from './activeClient';

const client = (over: Partial<ActiveClient> = {}): ActiveClient => ({
	id: '899317',
	name: 'Kongsakprasert, Sunthorn',
	mode: 'existing',
	since: '2026-09-09T00:00:00.000Z',
	...over
});

describe('linkableClientId', () => {
	beforeEach(() => activeClient.set(null));

	it('is the XPLAN id for an existing client', () => {
		activeClient.set(client());
		expect(get(linkableClientId)).toBe('899317');
	});

	it('is null when no client is selected', () => {
		expect(get(linkableClientId)).toBe(null);
	});

	it('is null for a new lead, whose id is local and not an XPLAN id', () => {
		activeClient.set(client({ id: 'new:Jane Doe', mode: 'new', name: 'Jane Doe' }));
		expect(get(linkableClientId)).toBe(null);
	});

	it('is null for an existing client with an empty id', () => {
		activeClient.set(client({ id: '' }));
		expect(get(linkableClientId)).toBe(null);
	});

	it('is null for an existing client whose id is only whitespace', () => {
		activeClient.set(client({ id: '   ' }));
		expect(get(linkableClientId)).toBe(null);
	});
});
