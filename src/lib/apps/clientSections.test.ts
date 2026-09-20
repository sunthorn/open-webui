import { describe, it, expect } from 'vitest';
import type { XplanClientSection } from '$lib/apis/gateway';
import { groupSections, defaultSection, sectionDot, sectionLabel } from './clientSections';

const sec = (section: string, status: XplanClientSection['status'], rows = 0, via = '1'): XplanClientSection => ({
	section,
	pageId: section,
	fetchedViaId: via,
	status,
	mapVersion: null,
	structureHash: null,
	headers: rows ? ['A'] : [],
	rows: Array.from({ length: rows }, (_, i) => ({ A: String(i) })),
	unmapped: {},
	fetchedAt: '2026-09-08T00:00:00Z'
});

describe('groupSections', () => {
	it('lists every known section in pages.py order, even when unread', () => {
		const groups = groupSections([]);
		expect(groups.map((g) => g.key)).toEqual(['client', 'financial', 'insurance', 'tasks']);
		expect(groups[0].entries.map((e) => e.section)).toEqual([
			'key_details', 'habits', 'contact', 'employment', 'dependants',
			'identity', 'domicile', 'category', 'notes', 'client_report'
		]);
		expect(groups[3].entries).toEqual([
			{ section: 'tasks', label: 'Tasks (open)', dot: 'empty', rowCount: 0, read: false }
		]);
	});

	it('sums rows across a couple\'s two reads of one section', () => {
		const groups = groupSections([sec('balancesheet', 'ok', 2, '1'), sec('balancesheet', 'ok', 3, '9')]);
		const entry = groups[1].entries.find((e) => e.section === 'balancesheet');
		expect(entry).toEqual({
			section: 'balancesheet', label: 'Assets & Liabilities', dot: 'current', rowCount: 5, read: true
		});
	});

	it('appends a section it does not know under the group it cannot place, rather than hiding it', () => {
		const groups = groupSections([sec('new_page', 'ok', 1)]);
		const all = groups.flatMap((g) => g.entries.map((e) => e.section));
		expect(all).toContain('new_page');
		expect(sectionLabel('new_page')).toBe('New page');
	});
});

describe('sectionDot', () => {
	it('is the worst of the rows: error > stale > current > empty', () => {
		expect(sectionDot([sec('x', 'ok', 1), sec('x', 'changed', 0, '9')])).toBe('stale');
		expect(sectionDot([sec('x', 'ok', 1), sec('x', 'error', 0, '9')])).toBe('error');
		expect(sectionDot([sec('x', 'empty'), sec('x', 'ok', 1, '9')])).toBe('current');
		expect(sectionDot([sec('x', 'empty')])).toBe('empty');
		expect(sectionDot([])).toBe('empty');
	});
});

describe('defaultSection', () => {
	it('prefers a hash that names a known section', () => {
		expect(defaultSection([sec('super', 'ok', 1)], '#super')).toBe('super');
	});
	it('ignores a hash that names nothing', () => {
		expect(defaultSection([sec('super', 'ok', 1)], '#nope')).toBe('super');
	});
	it('picks the first stale section in rail order over one with rows', () => {
		expect(defaultSection([sec('super', 'ok', 4), sec('contact', 'error', 0)])).toBe('contact');
	});
	it('then the first section with rows', () => {
		expect(defaultSection([sec('super', 'ok', 4), sec('contact', 'empty')])).toBe('super');
	});
	it('then the first section at all, and null when there are none', () => {
		expect(defaultSection([sec('super', 'empty'), sec('contact', 'empty')])).toBe('contact');
		expect(defaultSection([])).toBeNull();
	});
});
