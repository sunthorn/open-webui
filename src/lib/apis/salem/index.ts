/**
 * Talking to salem from the shell — only for the Unassigned count today.
 *
 * salem's routes want salem's own bearer, so the shell trades its session
 * (the httpOnly `token` cookie the gateway authenticates) for one via
 * salem's POST /api/auth/axi-session, exactly as the framed salem SPA and
 * finny's lib/salem.ts do. No service credential (auth-spec §5).
 */
const SALEM_API = '/api/salem/api';

let token: string | null = null;
let inflight: Promise<string> | null = null;

const exchange = async (): Promise<string> => {
	const res = await fetch(`${SALEM_API}/auth/axi-session`, {
		method: 'POST',
		credentials: 'same-origin'
	});
	if (!res.ok) throw new Error(`salem session exchange failed: ${res.status}`);
	token = ((await res.json()) as { access_token: string }).access_token;
	return token;
};

export const salemToken = async (): Promise<string> => {
	if (token) return token;
	if (!inflight) inflight = exchange().finally(() => (inflight = null));
	return inflight;
};

export const getUnassignedCount = async (): Promise<number> => {
	const call = async (t: string) =>
		fetch(`${SALEM_API}/unassigned/count`, { headers: { Authorization: `Bearer ${t}` } });
	let res = await call(await salemToken());
	if (res.status === 401) {
		token = null; // expired salem session: exchange once more
		res = await call(await salemToken());
	}
	if (!res.ok) throw new Error(`unassigned count: ${res.status}`);
	return ((await res.json()) as { count: number }).count;
};
