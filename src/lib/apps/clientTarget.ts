/**
 * Where "Client" in the Documents menu should land, and why it might not land
 * anywhere.
 *
 * This is a pure function so it can be tested: axi's vitest setup has no jsdom,
 * so nothing that lives inside a .svelte file is reachable from a test. The
 * gate route is a thin renderer over this.
 *
 * finny accepts an XPLAN client id directly at /clients/:id — it resolves
 * against public.client_directory before falling back to its own cuid space
 * (finny/backend/src/modules/client/client.service.ts:123-141). So there is no
 * id translation to do here and no finny endpoint to call.
 */
export type ClientTarget = { kind: 'ready'; href: string } | { kind: 'none' };

export const finnyClientTarget = (clientId: string | null, tab?: string): ClientTarget => {
	if (clientId) {
		const query = tab ? `?tab=${encodeURIComponent(tab)}` : '';
		return { kind: 'ready', href: `/x/finny/clients/${encodeURIComponent(clientId)}${query}` };
	}
	return { kind: 'none' };
};

/**
 * salem scopes by query parameter rather than by path: a meeting is not "at"
 * a client the way a finny profile is, it is merely recorded for one.
 */
export const withClient = (href: string, clientId: string | null): string =>
	clientId ? `${href}${href.includes('?') ? '&' : '?'}client=${encodeURIComponent(clientId)}` : href;

/**
 * Which menu rows carry the active client on their href. salem scopes every
 * page by `?client=`; finny scopes by path except its Documents page and its
 * Dashboard, which have no client in the path and read `?client=` instead
 * (spec 2026-10-08 §7: the Dashboard's top tile is the active client's
 * onboarding summary). axi's own rows have no XPLAN client to carry.
 */
const FINNY_QUERY_ROWS = ['finny-documents', 'finny-dashboard'];

export const scopeRowHref = (
	appId: string | undefined,
	rowId: string,
	href: string,
	clientId: string | null
): string =>
	appId === 'salem' || FINNY_QUERY_ROWS.includes(rowId) ? withClient(href, clientId) : href;

/**
 * `embed` and `client` belong to the shell: the frame always gets `embed=1`
 * and the active client is the axi URL's, so neither is passed through.
 * Everything else (`?meeting=`, `?note=`, `?tab=`) is the app's own deep link.
 */
const passThrough = (search: string): string => {
	const params = new URLSearchParams(search);
	params.delete('embed');
	params.delete('client');
	return params.toString();
};

const joinQuery = (path: string, query: string): string => (query ? `${path}?${query}` : path);

/**
 * The axi address for a framed page: the frame's own query kept, the client
 * re-attached from the axi URL (spec §3.2). Feeding it its own output returns
 * the same string, so the address-bar sync settles after one replaceState.
 */
export const shellUrlFor = (
	appId: string,
	innerPath: string,
	clientId: string | null,
	innerSearch = ''
): string => withClient(joinQuery(`/x/${appId}/${innerPath}`, passThrough(innerSearch)), clientId);

/**
 * The frame `src` for an axi URL: /x/salem/meetings?meeting=m1&client=C ->
 * /salem/meetings?embed=1&meeting=m1&client=C. Deep-link params ride along.
 */
export const frameSrcFor = (appId: string, rest: string, axiSearch: string): string => {
	const extra = passThrough(axiSearch);
	const path = `/${appId}/${rest}?embed=1${extra ? `&${extra}` : ''}`;
	return withClient(path, new URLSearchParams(axiSearch).get('client'));
};

/**
 * Where to send the browser when the active client changes WHILE the planner
 * is already sitting on a framed route.
 *
 * The picker (and the ✕ clear) used to only update the store — the iframe's
 * `src` is derived once, from the URL, when the frame first mounts, so
 * nothing re-read the store after that and the frame kept showing whoever
 * was active when it loaded. This is the piece that turns "the store
 * changed" into "the URL — and therefore the frame — changes too".
 *
 * Returns `null` when `pathname` is not a framed client route at all, so the
 * caller knows not to navigate.
 */
export const rescopeUrl = (pathname: string, clientId: string | null): string | null => {
	if (pathname === '/x/salem' || pathname.startsWith('/x/salem/')) {
		return withClient(pathname, clientId);
	}
	if (pathname === '/x/finny/documents' || pathname === '/x/finny' || pathname === '/x/finny/') {
		return withClient(pathname, clientId);
	}
	if (pathname.startsWith('/x/finny/clients/')) {
		if (!clientId) return '/x/finny/client';
		const target = finnyClientTarget(clientId);
		return target.kind === 'ready' ? target.href : null;
	}
	return null;
};
