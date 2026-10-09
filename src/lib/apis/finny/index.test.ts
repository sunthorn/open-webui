// open-webui/src/lib/apis/finny/index.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	FINNY_API,
	FinnyError,
	listClientDocuments,
	uploadClientDocument,
	getDocumentText,
	waitForDocumentText
} from './index';

const TOKEN = 'tok';

type Reply = { status: number; body?: unknown };

/** A fetch stub that answers each call from a queue, recording what was sent. */
const stub = (replies: Reply[]) => {
	const calls: { url: string; init: RequestInit }[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			const r = replies.shift() ?? { status: 500, body: {} };
			return {
				ok: r.status >= 200 && r.status < 300,
				status: r.status,
				json: async () => r.body ?? {}
			} as unknown as Response;
		})
	);
	return calls;
};

afterEach(() => vi.unstubAllGlobals());

const DOC = {
	id: 'doc1',
	title: 'factfind.pdf',
	status: 'ACTIVE',
	clientId: 'cl1',
	createdAt: '2026-10-08T00:00:00Z',
	updatedAt: '2026-10-08T00:00:00Z',
	currentVersion: { fileName: 'factfind.pdf', contentType: 'application/pdf', sizeBytes: 10, createdAt: '2026-10-08T00:00:00Z' }
};

describe('listClientDocuments', () => {
	it('lists the client\'s documents through the gateway with the browser session', async () => {
		const calls = stub([{ status: 200, body: { items: [DOC], page: 1, pageSize: 100, total: 1 } }]);
		expect(await listClientDocuments(TOKEN, '899317')).toEqual([DOC]);
		expect(calls[0].url).toBe(`${FINNY_API}/clients/899317/documents?pageSize=100`);
		expect(calls[0].init.credentials).toBe('include');
	});

	it('opens a finny session once on 401 and retries', async () => {
		// The cookie is missing until the planner has opened finny's frame at
		// least once; the gateway identity is enough to mint one.
		const calls = stub([
			{ status: 401, body: { message: 'Authentication required' } },
			{ status: 200, body: {} },
			{ status: 200, body: { items: [], total: 0 } }
		]);
		expect(await listClientDocuments(TOKEN, '899317')).toEqual([]);
		expect(calls.map((c) => c.url)).toEqual([
			`${FINNY_API}/clients/899317/documents?pageSize=100`,
			`${FINNY_API}/auth/axi-session`,
			`${FINNY_API}/clients/899317/documents?pageSize=100`
		]);
		expect(calls[1].init.method).toBe('POST');
	});

	it('does not loop when the session exchange itself is refused', async () => {
		stub([
			{ status: 401, body: {} },
			{ status: 403, body: { message: 'Your axi account is not a member of any organisation in finny yet.' } }
		]);
		await expect(listClientDocuments(TOKEN, '899317')).rejects.toMatchObject({
			status: 403,
			message: 'Your axi account is not a member of any organisation in finny yet.'
		});
	});
});

describe('uploadClientDocument', () => {
	it('POSTs multipart file + title to the client\'s documents', async () => {
		const calls = stub([{ status: 201, body: DOC }]);
		const file = new File(['hello'], 'factfind.pdf', { type: 'application/pdf' });
		expect(await uploadClientDocument(TOKEN, '899317', file)).toEqual(DOC);
		expect(calls[0].url).toBe(`${FINNY_API}/clients/899317/documents`);
		expect(calls[0].init.method).toBe('POST');
		const body = calls[0].init.body as FormData;
		expect(body.get('title')).toBe('factfind.pdf');
		expect((body.get('file') as File).name).toBe('factfind.pdf');
		// No Content-Type by hand: the browser sets the multipart boundary.
		expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
	});

	it("surfaces finny's 400 message for a rejected file", async () => {
		// Review Focus 5. OWUI accepted .txt; finny does not. The planner
		// must see finny's reason, not "HTTP 400".
		stub([{ status: 400, body: { message: 'File type not allowed: text/plain' } }]);
		const file = new File(['x'], 'notes.txt', { type: 'text/plain' });
		await expect(uploadClientDocument(TOKEN, '899317', file)).rejects.toThrow(
			'File type not allowed: text/plain'
		);
	});
});

describe('getDocumentText / waitForDocumentText', () => {
	it('reads the text route', async () => {
		const calls = stub([{ status: 200, body: { documentId: 'doc1', status: 'INDEXED', text: 'hi' } }]);
		expect((await getDocumentText(TOKEN, 'doc1')).text).toBe('hi');
		expect(calls[0].url).toBe(`${FINNY_API}/documents/doc1/text`);
	});

	it('waits for INDEXED then returns the text', async () => {
		// Review Focus 4: ingest is asynchronous (BullMQ); the first reads say
		// PENDING/EMBEDDING and the page must not send empty text to the model.
		const calls = stub([
			{ status: 200, body: { status: 'PENDING', text: null } },
			{ status: 200, body: { status: 'EMBEDDING', text: null } },
			{ status: 200, body: { status: 'INDEXED', text: 'Super balance $410k' } }
		]);
		const sleep = vi.fn(async () => {});
		const text = await waitForDocumentText(TOKEN, 'doc1', 'factfind.pdf', { sleep, intervalMs: 1, timeoutMs: 1000 });
		expect(text).toBe('Super balance $410k');
		expect(calls).toHaveLength(3);
		expect(sleep).toHaveBeenCalledTimes(2);
	});

	it('names the file when ingest FAILED', async () => {
		stub([{ status: 200, body: { status: 'FAILED', errorMessage: 'no text layer', text: null } }]);
		await expect(
			waitForDocumentText(TOKEN, 'doc1', 'scan.pdf', { sleep: async () => {}, timeoutMs: 1000 })
		).rejects.toThrow('finny could not extract text from "scan.pdf": no text layer');
	});

	it('names the file on timeout', async () => {
		stub(Array.from({ length: 50 }, () => ({ status: 200, body: { status: 'EXTRACTING', text: null } })));
		let now = 0;
		await expect(
			waitForDocumentText(TOKEN, 'doc1', 'big.pdf', {
				sleep: async (ms: number) => { now += ms; },
				clock: () => now,
				intervalMs: 100,
				timeoutMs: 250
			})
		).rejects.toThrow('Timed out waiting for finny to index "big.pdf"');
	});

	it('treats indexed-but-empty as no text', async () => {
		stub([{ status: 200, body: { status: 'INDEXED', text: '   ' } }]);
		await expect(
			waitForDocumentText(TOKEN, 'doc1', 'blank.pdf', { sleep: async () => {}, timeoutMs: 1000 })
		).rejects.toThrow('No text could be extracted from "blank.pdf"');
	});
});
