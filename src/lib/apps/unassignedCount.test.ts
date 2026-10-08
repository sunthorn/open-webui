import { describe, it, expect } from 'vitest';
import { badgeLabel } from './unassignedCount';

describe('badgeLabel', () => {
	it('is empty for nothing to show', () => {
		expect(badgeLabel(null)).toBe('');
		expect(badgeLabel(0)).toBe('');
	});
	it('shows the count, capped', () => {
		expect(badgeLabel(7)).toBe('7');
		expect(badgeLabel(99)).toBe('99');
		expect(badgeLabel(250)).toBe('99+');
	});
});
