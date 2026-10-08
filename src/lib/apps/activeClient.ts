// The "active client" — who the planner is currently working on. Persisted to
// the browser so it survives navigation between apps and reloads, until the
// planner picks a different client on the Clients hub.
import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';

export interface ActiveClient {
	id: string; // the XPLAN client id — the only kind of client there is (client-identity-spec §1)
	name: string;
	since: string; // ISO — when they became the active client
}

const ACTIVE_KEY = 'xplan.activeClient';
const RECENT_KEY = 'xplan.recentClients';

/**
 * Rows written by the previous release carried `mode: 'new'` and a LOCAL id
 * (`new:<name>` from the hub, `lead-…` from its id minter). Those were never
 * XPLAN clients; after the upgrade they must not become one. Anything that
 * is not a {id, name, since} with a real id is dropped.
 */
export const sanitizeStored = (list: unknown[]): ActiveClient[] =>
	list.flatMap((raw) => {
		if (!raw || typeof raw !== 'object') return [];
		const r = raw as Record<string, unknown>;
		const id = typeof r.id === 'string' ? r.id.trim() : '';
		if (!id || id.startsWith('new:') || id.startsWith('lead-')) return [];
		return [{ id, name: String(r.name ?? ''), since: String(r.since ?? '') }];
	});

const readJSON = <T>(key: string, fallback: T): T => {
	if (!browser) return fallback;
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
};

const readActive = (): ActiveClient | null => {
	const raw = readJSON<unknown>(ACTIVE_KEY, null);
	return raw ? (sanitizeStored([raw])[0] ?? null) : null;
};

export const activeClient = writable<ActiveClient | null>(readActive());
export const recentClients = writable<ActiveClient[]>(sanitizeStored(readJSON<unknown[]>(RECENT_KEY, [])));

/** The active client's XPLAN id, or null when nothing is selected. */
export const linkableClientId = derived(activeClient, ($c) =>
	$c && $c.id.trim() ? $c.id.trim() : null
);

if (browser) {
	activeClient.subscribe((v) => {
		try {
			if (v) localStorage.setItem(ACTIVE_KEY, JSON.stringify(v));
			else localStorage.removeItem(ACTIVE_KEY);
		} catch {
			/* ignore quota/serialization errors */
		}
	});
	recentClients.subscribe((v) => {
		try {
			localStorage.setItem(RECENT_KEY, JSON.stringify(v));
		} catch {
			/* ignore */
		}
	});
}

const keyOf = (c: { id?: string; name: string }) => (c.id || c.name.trim().toLowerCase());

/** Make `c` the active client and push it to the front of Recent (deduped). */
export const setActiveClient = (c: ActiveClient): void => {
	activeClient.set(c);
	recentClients.update((list) => {
		const k = keyOf(c);
		return [c, ...list.filter((x) => keyOf(x) !== k)].slice(0, 8);
	});
};

export const clearActiveClient = (): void => activeClient.set(null);

/**
 * Forget the Recent list.
 *
 * Recent lives in localStorage, per browser — so it survives a wipe of the
 * database, and clearing the client book does not clear it. Without this the
 * only way to drop a name was DevTools.
 *
 * The active client is left alone: it has its own control in the top bar, and
 * clearing Recent while you are still working on someone should not silently
 * put you back to "no client selected".
 */
export const clearRecentClients = (): void => recentClients.set([]);
