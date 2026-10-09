import { describe, it, expect, vi, beforeEach } from 'vitest';

const finny = vi.hoisted(() => ({
	uploadClientDocument: vi.fn(),
	waitForDocumentText: vi.fn()
}));
vi.mock('$lib/apis/finny', () => finny);

import { extractDocument, extractExisting } from './index';

beforeEach(() => {
	finny.uploadClientDocument.mockReset();
	finny.waitForDocumentText.mockReset();
});

describe('extractDocument', () => {
	it('uploads to the client in finny, then waits for its text', async () => {
		finny.uploadClientDocument.mockResolvedValue({ id: 'doc1', title: 'factfind.pdf' });
		finny.waitForDocumentText.mockResolvedValue('Super $410k');
		const file = new File(['x'], 'factfind.pdf', { type: 'application/pdf' });
		expect(await extractDocument('tok', file, '899317')).toEqual({
			filename: 'factfind.pdf',
			text: 'Super $410k',
			documentId: 'doc1'
		});
		expect(finny.uploadClientDocument).toHaveBeenCalledWith('tok', '899317', file);
		expect(finny.waitForDocumentText).toHaveBeenCalledWith('tok', 'doc1', 'factfind.pdf');
	});

	it("lets finny's refusal through untouched", async () => {
		finny.uploadClientDocument.mockRejectedValue(new Error('File type not allowed: text/plain'));
		const file = new File(['x'], 'a.txt', { type: 'text/plain' });
		await expect(extractDocument('tok', file, '899317')).rejects.toThrow(
			'File type not allowed: text/plain'
		);
		expect(finny.waitForDocumentText).not.toHaveBeenCalled();
	});
});

describe('extractExisting', () => {
	it('reads text for a document already in finny, named by its file', async () => {
		finny.waitForDocumentText.mockResolvedValue('text');
		const doc = {
			id: 'doc2',
			title: 'Bank statement',
			currentVersion: { fileName: 'cba-aug.pdf' }
		} as any;
		expect(await extractExisting('tok', doc)).toEqual({
			filename: 'cba-aug.pdf',
			text: 'text',
			documentId: 'doc2'
		});
		expect(finny.uploadClientDocument).not.toHaveBeenCalled();
	});
});
