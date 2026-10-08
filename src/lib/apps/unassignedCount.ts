// The Unassigned inbox size, shown on the salem menu row (spec §4.1, §8).
import { writable } from 'svelte/store';
import { getUnassignedCount } from '$lib/apis/salem';

export const unassignedCount = writable<number | null>(null);

export const badgeLabel = (n: number | null): string =>
	!n || n <= 0 ? '' : n > 99 ? '99+' : String(n);

let inflight: Promise<void> | null = null;

/** Best-effort: a failed read leaves the last value and never throws. */
export const refreshUnassignedCount = (): Promise<void> => {
	if (inflight) return inflight;
	inflight = getUnassignedCount()
		.then((n) => unassignedCount.set(n))
		.catch((e) => console.warn('unassigned count:', e))
		.finally(() => (inflight = null));
	return inflight;
};
