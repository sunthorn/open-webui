/**
 * The active client, named on chat completions so the agent's search is
 * scoped to them (shared-contracts/search-spec.md; spec 2026-10-08 §3.6).
 * This is the ONE place a client id travels as a header: page navigation
 * stays on the URL (client-identity-spec §10). The backend forwards it to
 * the hermes connection only. Only a value hermes would keep
 * (^[A-Za-z0-9:_-]{1,64}$) is sent; anything else is omitted.
 */
const CLIENT_ID = /^[A-Za-z0-9:_-]{1,64}$/;

export const clientHeader = (id: string | null): Record<string, string> => {
	const v = (id ?? '').trim();
	return CLIENT_ID.test(v) ? { 'X-Axi-Client': v } : {};
};
