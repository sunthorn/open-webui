import { describe, it, expect } from 'vitest';
import { finnyClientTarget } from './clientTarget';

describe('finnyClientTarget', () => {
	it('routes to the client profile when there is an XPLAN id', () => {
		expect(finnyClientTarget('899317', null)).toEqual({
			kind: 'ready',
			href: '/x/finny/clients/899317'
		});
	});

	it('appends the tab when one is asked for', () => {
		expect(finnyClientTarget('899317', null, 'documents')).toEqual({
			kind: 'ready',
			href: '/x/finny/clients/899317?tab=documents'
		});
	});

	it('encodes an id that would otherwise break the path', () => {
		const t = finnyClientTarget('a/b?c', null);
		expect(t).toEqual({ kind: 'ready', href: '/x/finny/clients/a%2Fb%3Fc' });
	});

	it('reports a lead, and carries its name for the message', () => {
		expect(finnyClientTarget(null, 'Jane Doe')).toEqual({ kind: 'lead', name: 'Jane Doe' });
	});

	it('reports nothing selected when there is neither an id nor a lead', () => {
		expect(finnyClientTarget(null, null)).toEqual({ kind: 'none' });
	});

	it('prefers the id over the lead name when both are somehow present', () => {
		expect(finnyClientTarget('899317', 'Jane Doe')).toEqual({
			kind: 'ready',
			href: '/x/finny/clients/899317'
		});
	});
});
