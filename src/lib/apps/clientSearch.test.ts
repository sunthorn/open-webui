import { describe, it, expect } from 'vitest';
import { mergeRows } from './clientSearch';
import type { ActiveClient } from './activeClient';

const recent = (id: string, name: string): ActiveClient => ({
	id,
	name,
	mode: 'existing',
	since: '2026-09-09T00:00:00.000Z'
});

describe('mergeRows', () => {
	it('shows only recents before anything is typed', () => {
		const rows = mergeRows([recent('1', 'Abbey, Vanessa')], [{ id: '2', name: 'Acker, Natasha' }], '');
		expect(rows).toEqual([{ id: '1', name: 'Abbey, Vanessa', recent: true }]);
	});

	it('puts matching recents above search results once there is a query', () => {
		const rows = mergeRows(
			[recent('1', 'Abbey, Vanessa')],
			[{ id: '2', name: 'Acker, Natasha' }],
			'a'
		);
		expect(rows).toEqual([
			{ id: '1', name: 'Abbey, Vanessa', recent: true },
			{ id: '2', name: 'Acker, Natasha', recent: false }
		]);
	});

	it('drops a recent that does not match the query', () => {
		const rows = mergeRows([recent('1', 'Zeta, Bob')], [{ id: '2', name: 'Acker, Natasha' }], 'ack');
		expect(rows).toEqual([{ id: '2', name: 'Acker, Natasha', recent: false }]);
	});

	it('does not list a client twice when it is both recent and a result', () => {
		const rows = mergeRows(
			[recent('1', 'Abbey, Vanessa')],
			[{ id: '1', name: 'Abbey, Vanessa' }],
			'abb'
		);
		expect(rows).toEqual([{ id: '1', name: 'Abbey, Vanessa', recent: true }]);
	});

	it('matches a recent case-insensitively', () => {
		const rows = mergeRows([recent('1', 'Abbey, Vanessa')], [], 'VANESSA');
		expect(rows).toEqual([{ id: '1', name: 'Abbey, Vanessa', recent: true }]);
	});

	it('skips a recent lead, which has no XPLAN id to switch to', () => {
		const lead: ActiveClient = {
			id: 'new:Jane Doe',
			name: 'Jane Doe',
			mode: 'new',
			since: '2026-09-09T00:00:00.000Z'
		};
		expect(mergeRows([lead], [], '')).toEqual([]);
	});
});
