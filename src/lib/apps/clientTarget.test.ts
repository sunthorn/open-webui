import { describe, it, expect } from 'vitest';
import {
	finnyClientTarget,
	frameSrcFor,
	withClient,
	rescopeUrl,
	scopeRowHref,
	shellUrlFor
} from './clientTarget';

describe('finnyClientTarget', () => {
	it('routes to the client profile when there is an XPLAN id', () => {
		expect(finnyClientTarget('899317')).toEqual({
			kind: 'ready',
			href: '/x/finny/clients/899317'
		});
	});

	it('appends the tab when one is asked for', () => {
		expect(finnyClientTarget('899317', 'documents')).toEqual({
			kind: 'ready',
			href: '/x/finny/clients/899317?tab=documents'
		});
	});

	it('encodes an id that would otherwise break the path', () => {
		const t = finnyClientTarget('a/b?c');
		expect(t).toEqual({ kind: 'ready', href: '/x/finny/clients/a%2Fb%3Fc' });
	});

	it('reports nothing selected when there is no id', () => {
		expect(finnyClientTarget(null)).toEqual({ kind: 'none' });
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

describe('scopeRowHref', () => {
	it('scopes salem rows', () => {
		expect(scopeRowHref('salem', 'salem-notes', '/x/salem/notes', '899317')).toBe('/x/salem/notes?client=899317');
	});
	it('scopes the finny Documents row only', () => {
		expect(scopeRowHref('finny', 'finny-documents', '/x/finny/documents', '899317')).toBe('/x/finny/documents?client=899317');
		expect(scopeRowHref('finny', 'finny-templates', '/x/finny/templates', '899317')).toBe('/x/finny/templates');
	});
	it('leaves axi rows and no-client cases alone', () => {
		expect(scopeRowHref('xplan', 'xplan-clients', '/apps/clients', '899317')).toBe('/apps/clients');
		expect(scopeRowHref('salem', 'salem-notes', '/x/salem/notes', null)).toBe('/x/salem/notes');
	});
});

describe('shellUrlFor', () => {
	it('keeps the client on the address bar after the frame navigates', () => {
		expect(shellUrlFor('salem', 'notes', '899317')).toBe('/x/salem/notes?client=899317');
	});
	it('is the bare path with no client', () => {
		expect(shellUrlFor('salem', 'meetings', null)).toBe('/x/salem/meetings');
	});
	it('encodes the id', () => {
		expect(shellUrlFor('salem', 'kb', 'a b')).toBe('/x/salem/kb?client=a%20b');
	});
	it("keeps the frame's own query, minus embed and its client", () => {
		expect(shellUrlFor('salem', 'meetings', '899317', '?embed=1&meeting=m1&client=old')).toBe(
			'/x/salem/meetings?meeting=m1&client=899317'
		);
	});
	it("keeps the frame's query when there is no client", () => {
		expect(shellUrlFor('finny', 'clients/9', null, '?tab=documents')).toBe(
			'/x/finny/clients/9?tab=documents'
		);
	});
	it('is stable when fed its own output, so replaceState settles', () => {
		const once = shellUrlFor('salem', 'notes', 'c 1', '?note=a%20b&embed=1');
		const search = once.slice(once.indexOf('?'));
		expect(shellUrlFor('salem', 'notes', 'c 1', search)).toBe(once);
	});
});

describe('frameSrcFor', () => {
	it('is the app path with embed=1', () => {
		expect(frameSrcFor('salem', 'meetings', '')).toBe('/salem/meetings?embed=1');
	});
	it('carries the client', () => {
		expect(frameSrcFor('salem', 'meetings', '?client=899317')).toBe(
			'/salem/meetings?embed=1&client=899317'
		);
	});
	it('forwards a salem meeting deep link intact', () => {
		expect(frameSrcFor('salem', 'meetings', '?meeting=m-1&client=899317')).toBe(
			'/salem/meetings?embed=1&meeting=m-1&client=899317'
		);
	});
	it('forwards a salem note deep link intact', () => {
		expect(frameSrcFor('salem', 'notes', '?note=n1&client=899317')).toBe(
			'/salem/notes?embed=1&note=n1&client=899317'
		);
	});
	it('forwards a finny tab deep link', () => {
		expect(frameSrcFor('finny', 'clients/899317', '?tab=documents')).toBe(
			'/finny/clients/899317?embed=1&tab=documents'
		);
	});
	it('never doubles embed or client from the axi URL', () => {
		expect(frameSrcFor('salem', 'kb', '?embed=0&client=a&client=b&q=x')).toBe(
			'/salem/kb?embed=1&q=x&client=a'
		);
	});
});

describe('rescopeUrl for finny documents', () => {
	it('re-scopes the Documents page when the client changes', () => {
		expect(rescopeUrl('/x/finny/documents', '1')).toBe('/x/finny/documents?client=1');
		expect(rescopeUrl('/x/finny/documents', null)).toBe('/x/finny/documents');
	});
});
