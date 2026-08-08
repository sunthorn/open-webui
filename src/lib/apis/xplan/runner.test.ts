import { describe, it, expect, vi } from 'vitest';
import { runOperation, XplanNotLoggedInError, XplanCancelledError, XplanReadOnlyError, gatherXplanClientBook } from './index';
import type { XplanOperation } from './playbook';

const writeOp: XplanOperation = {
	id: 'test.write', title: 'W', reconDoc: 'x', url: 'https://example.invalid/w',
	extract: ['x'], outputFormat: 'text', outputSpec: 'text',
	parse: (raw) => ({ raw }), write: true
};

const op: XplanOperation = {
	id: 'test.op', title: 'T', reconDoc: 'x', url: 'https://example.invalid/p',
	extract: ['x'], outputFormat: 'text', outputSpec: 'text',
	parse: (raw) => ({ raw })
};

const okResponse = (content: string) =>
	({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) }) as unknown as Response;

describe('runOperation', () => {
	it('POSTs the built prompt to the OWUI proxy and returns parsed output', async () => {
		const fetchFn = vi.fn(async () => okResponse('hello'));
		const out = await runOperation<{ raw: string }>(op, 'tok', {}, fetchFn as unknown as typeof fetch);
		expect(out).toEqual({ raw: 'hello' });
		const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toContain('/openai/chat/completions');
		const body = JSON.parse(String(init.body));
		expect(body.model).toBe('hermes-agent');
		expect(body.messages[0].content).toContain('Do EXACTLY this and nothing more');
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
	});
	it('throws XplanNotLoggedInError on the sentinel', async () => {
		const fetchFn = vi.fn(async () => okResponse('NOT_LOGGED_IN'));
		await expect(runOperation(op, 'tok', {}, fetchFn as unknown as typeof fetch))
			.rejects.toBeInstanceOf(XplanNotLoggedInError);
	});
	it('strips code fences before parsing', async () => {
		const fetchFn = vi.fn(async () => okResponse('```json\nfenced\n```'));
		const out = await runOperation<{ raw: string }>(op, 'tok', {}, fetchFn as unknown as typeof fetch);
		expect(out.raw).toBe('fenced');
	});
	it('surfaces backend HTTP errors with detail', async () => {
		const fetchFn = vi.fn(async () =>
			({ ok: false, status: 500, json: async () => ({ detail: 'boom' }) }) as unknown as Response);
		await expect(runOperation(op, 'tok', {}, fetchFn as unknown as typeof fetch)).rejects.toThrow('boom');
	});
	it('extracts the message from an OpenAI-shaped object error (no "[object Object]")', async () => {
		const fetchFn = vi.fn(async () =>
			({ ok: false, status: 502, json: async () => ({ error: { message: 'browser has no page target' } }) }) as unknown as Response);
		const err = await runOperation(op, 'tok', {}, fetchFn as unknown as typeof fetch).catch((e) => e);
		expect(err.message).toBe('browser has no page target');
		expect(err.message).not.toContain('[object Object]');
	});
	it('falls back to an HTTP message when the error body has no string message', async () => {
		const fetchFn = vi.fn(async () =>
			({ ok: false, status: 503, json: async () => ({ error: { code: 42 } }) }) as unknown as Response);
		await expect(runOperation(op, 'tok', {}, fetchFn as unknown as typeof fetch)).rejects.toThrow('HTTP 503');
	});
	it('throws XplanCancelledError (not a timeout) when the caller aborts', async () => {
		const ac = new AbortController();
		ac.abort();
		// A real fetch rejects with an AbortError once its signal is aborted.
		const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
			if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
			return okResponse('hi');
		});
		await expect(
			runOperation(op, 'tok', {}, fetchFn as unknown as typeof fetch, ac.signal)
		).rejects.toBeInstanceOf(XplanCancelledError);
	});
});

describe('gatherXplanClientBook', () => {
	const okBody = (obj: unknown) =>
		({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }) }) as unknown as Response;
	it('returns the parsed sweep result and passes navigateFirst/pages into the prompt', async () => {
		const fetchFn = vi.fn(async () => okBody({ total: 757, reachedEnd: false, rows: [{ name: 'A, B', id: '1' }] }));
		const r = await gatherXplanClientBook('tok', { navigateFirst: true, pages: 3 }, 150_000, undefined, fetchFn as unknown as typeof fetch);
		expect(r).toEqual({ total: 757, reachedEnd: false, rows: [{ name: 'A, B', id: '1' }] });
		const body = JSON.parse(String((fetchFn.mock.calls[0] as any)[1].body));
		expect(body.messages[0].content).toContain('browser_navigate once to');
	});
	it('returns NOT_LOGGED_IN sentinel', async () => {
		const fetchFn = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'NOT_LOGGED_IN' } }] }) }) as unknown as Response);
		const r = await gatherXplanClientBook('tok', { navigateFirst: false, pages: 3 }, 150_000, undefined, fetchFn as unknown as typeof fetch);
		expect(r).toBe('NOT_LOGGED_IN');
	});
});

describe('runOperation write-gate', () => {
	it('throws XplanReadOnlyError for a write op unless access is full', async () => {
		const fetchFn = vi.fn(async () => okResponse('x'));
		await expect(runOperation(writeOp, 'tok', {}, fetchFn as unknown as typeof fetch, undefined, 'readonly'))
			.rejects.toBeInstanceOf(XplanReadOnlyError);
		expect(fetchFn).not.toHaveBeenCalled(); // gate is BEFORE any hermes call
	});
	it('blocks a write op when access level is omitted (safe default)', async () => {
		const fetchFn = vi.fn(async () => okResponse('x'));
		await expect(runOperation(writeOp, 'tok', {}, fetchFn as unknown as typeof fetch))
			.rejects.toBeInstanceOf(XplanReadOnlyError);
	});
	it('allows a write op when access is full', async () => {
		const fetchFn = vi.fn(async () => okResponse('ok'));
		const out = await runOperation<{ raw: string }>(writeOp, 'tok', {}, fetchFn as unknown as typeof fetch, undefined, 'full');
		expect(out).toEqual({ raw: 'ok' });
	});
	it('does not gate a read op in readonly', async () => {
		const fetchFn = vi.fn(async () => okResponse('r'));
		const out = await runOperation<{ raw: string }>(op, 'tok', {}, fetchFn as unknown as typeof fetch, undefined, 'readonly');
		expect(out).toEqual({ raw: 'r' });
	});
});
