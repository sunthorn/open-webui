import { describe, it, expect } from 'vitest';
import { accessMeta } from './index';

describe('accessMeta', () => {
	it('maps each tier to icon + label', () => {
		expect(accessMeta('lock')).toMatchObject({ icon: '🔒', label: 'Lock', isLock: true, canWrite: false });
		expect(accessMeta('readonly')).toMatchObject({ icon: '👁', label: 'Read-only', isLock: false, canWrite: false });
		expect(accessMeta('full')).toMatchObject({ icon: '✍️', label: 'Full', isLock: false, canWrite: true });
	});
});
