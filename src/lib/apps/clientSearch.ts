import type { ActiveClient } from './activeClient';

export type PickerRow = { id: string; name: string; recent: boolean };

/**
 * What the picker lists.
 *
 * Recents come first because switching back to someone you were just with is
 * the common case. A recent with a blank id is skipped: there is no XPLAN
 * client to switch to (stale lead ids are already dropped on read, see
 * sanitizeStored in activeClient.ts).
 */
export const mergeRows = (
	recent: ActiveClient[],
	results: { id: string; name: string }[],
	query: string
): PickerRow[] => {
	const q = query.trim().toLowerCase();
	const usable = recent.filter((c) => c.id.trim());
	const recentRows = usable
		.filter((c) => !q || c.name.toLowerCase().includes(q))
		.map((c) => ({ id: c.id, name: c.name, recent: true }));

	if (!q) return recentRows;

	const seen = new Set(recentRows.map((r) => r.id));
	const resultRows = results
		.filter((r) => !seen.has(r.id))
		.map((r) => ({ id: r.id, name: r.name, recent: false }));

	return [...recentRows, ...resultRows];
};
