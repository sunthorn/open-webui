// The "active client" — who the planner is currently working on. Persisted to
// the browser so it survives navigation between apps and reloads, until the
// planner picks a different client on the Clients hub.
import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export interface ActiveClient {
	id: string; // XPLAN client id if known; else a local id (e.g. 'new:<name>')
	name: string;
	mode: 'existing' | 'new';
	since: string; // ISO — when they became the active client
}

const ACTIVE_KEY = 'xplan.activeClient';
const RECENT_KEY = 'xplan.recentClients';

const readJSON = <T>(key: string, fallback: T): T => {
	if (!browser) return fallback;
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
};

export const activeClient = writable<ActiveClient | null>(readJSON(ACTIVE_KEY, null));
export const recentClients = writable<ActiveClient[]>(readJSON(RECENT_KEY, []));

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
