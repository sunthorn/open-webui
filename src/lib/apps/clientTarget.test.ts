import { describe, it, expect } from 'vitest';
import { finnyClientTarget, withClient, rescopeUrl } from './clientTarget';

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

describe('withClient', () => {
	it('appends the client to a plain path', () => {
		expect(withClient('/x/salem/meetings', '899317')).toBe('/x/salem/meetings?client=899317');
	});

	it('appends with & when the path already has a query', () => {
		expect(withClient('/x/salem/notes?folder=1', '899317')).toBe(
			'/x/salem/notes?folder=1&client=899317'
		);
	});

	it('leaves the path alone when there is no linkable client', () => {
		expect(withClient('/x/salem/meetings', null)).toBe('/x/salem/meetings');
	});
});

describe('rescopeUrl', () => {
	it('re-attaches the new client to a salem page as a query param', () => {
		expect(rescopeUrl('/x/salem/meetings', '899317')).toBe('/x/salem/meetings?client=899317');
	});

	it('re-attaches the new client to a nested salem page', () => {
		expect(rescopeUrl('/x/salem/notes/123', '899317')).toBe('/x/salem/notes/123?client=899317');
	});

	it('drops the query param from a salem page when the client is cleared', () => {
		expect(rescopeUrl('/x/salem/meetings', null)).toBe('/x/salem/meetings');
	});

	it('re-points a finny client page at the new client', () => {
		expect(rescopeUrl('/x/finny/clients/A', 'B')).toBe('/x/finny/clients/B');
	});

	it('sends a finny client page back to the gate route when the client is cleared', () => {
		expect(rescopeUrl('/x/finny/clients/A', null)).toBe('/x/finny/client');
	});

	it('returns null for a route that is not framed', () => {
		expect(rescopeUrl('/apps/clients', '899317')).toBeNull();
	});

	it('returns null for the finny gate route itself', () => {
		expect(rescopeUrl('/x/finny/client', '899317')).toBeNull();
	});
});
