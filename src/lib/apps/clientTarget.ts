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
export type ClientTarget =
	| { kind: 'ready'; href: string }
	| { kind: 'lead'; name: string }
	| { kind: 'none' };

export const finnyClientTarget = (
	clientId: string | null,
	leadName: string | null,
	tab?: string
): ClientTarget => {
	if (clientId) {
		const query = tab ? `?tab=${encodeURIComponent(tab)}` : '';
		return { kind: 'ready', href: `/x/finny/clients/${encodeURIComponent(clientId)}${query}` };
	}
	if (leadName) return { kind: 'lead', name: leadName };
	return { kind: 'none' };
};

/**
 * salem scopes by query parameter rather than by path: a meeting is not "at"
 * a client the way a finny profile is, it is merely recorded for one.
 */
export const withClient = (href: string, clientId: string | null): string =>
	clientId ? `${href}${href.includes('?') ? '&' : '?'}client=${encodeURIComponent(clientId)}` : href;

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
	if (pathname.startsWith('/x/finny/clients/')) {
		if (!clientId) return '/x/finny/client';
		const target = finnyClientTarget(clientId, null);
		return target.kind === 'ready' ? target.href : null;
	}
	return null;
};
