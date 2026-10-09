import { describe, it, expect } from 'vitest';
import { sessionIdFor, resumeFrom, mergeDocs, fileKey, discardedSession, ACCEPTED_TYPES } from './dataEntry';

const proposal = { client: { mode: 'existing', name: 'Smith, Jo' }, compiledAt: 'x', sourceDocs: ['a.pdf'], items: [] } as any;
const withItems = { ...proposal, items: [{ id: 'p:dob', status: 'proposed' }] } as any;

describe('sessionIdFor', () => {
	it('keys the saved session by the client, not a random id', () => {
		// saveOnboardingSession stores at `onboarding:{sessionId}`; passing the
		// XPLAN id makes the key `onboarding:899317`, which a reload can find.
		expect(sessionIdFor('899317')).toBe('899317');
	});
});

describe('resumeFrom', () => {
	it('starts at upload with nothing saved', () => {
		expect(resumeFrom(null)).toEqual({ stage: 'upload', proposal: null });
	});
	it('resumes a proposed or reviewed session at the review step', () => {
		expect(resumeFrom({ sessionId: '899317', stage: 'proposed', proposal: withItems, updatedAt: 'x' })).toEqual({ stage: 'review', proposal: withItems });
		expect(resumeFrom({ sessionId: '899317', stage: 'reviewed', proposal: withItems, updatedAt: 'x' })).toEqual({ stage: 'review', proposal: withItems });
	});
	it('ignores a saved session with no items to review', () => {
		expect(resumeFrom({ sessionId: '899317', stage: 'proposed', proposal: { ...proposal, items: undefined }, updatedAt: 'x' } as any))
			.toEqual({ stage: 'upload', proposal: null });
	});
});

describe('discardedSession', () => {
	it('is what Start over saves, and a reload does not resume it (A21)', () => {
		const s = discardedSession('899317', withItems, '2026-10-09T00:00:00Z');
		expect(s).toEqual({ sessionId: '899317', stage: 'draft', proposal: { ...withItems, items: [] }, updatedAt: '2026-10-09T00:00:00Z' });
		expect(resumeFrom(s)).toEqual({ stage: 'upload', proposal: null });
		// the proposal on screen is not mutated
		expect(withItems.items).toHaveLength(1);
	});
});

describe('mergeDocs', () => {
	it('dedupes by finny document id, then by filename', () => {
		const a = { filename: 'a.pdf', text: '1', documentId: 'd1' };
		const b = { filename: 'b.pdf', text: '2', documentId: 'd2' };
		expect(mergeDocs([a], [{ ...a, text: 'again' }, b])).toEqual([a, b]);
		expect(mergeDocs([{ filename: 'c.pdf', text: 'x' }], [{ filename: 'c.pdf', text: 'y' }])).toHaveLength(1);
	});
});

describe('fileKey', () => {
	it('names a file by name and size, so a retry finds what was already uploaded (A14)', () => {
		expect(fileKey({ name: 'a.pdf', size: 1024 })).toBe('a.pdf:1024');
		expect(fileKey({ name: 'a.pdf', size: 1024 })).not.toBe(fileKey({ name: 'a.pdf', size: 2048 }));
	});
});

describe('ACCEPTED_TYPES', () => {
	it('lists what finny allows, not what OWUI did', () => {
		// finny: documents.service.ts ALLOWED_CONTENT_TYPES.
		expect(ACCEPTED_TYPES).toContain('application/pdf');
		expect(ACCEPTED_TYPES).toContain('application/vnd.ms-word');
		expect(ACCEPTED_TYPES).toHaveLength(7);
		expect(ACCEPTED_TYPES).not.toContain('text/plain');
	});
});
