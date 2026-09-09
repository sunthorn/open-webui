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
