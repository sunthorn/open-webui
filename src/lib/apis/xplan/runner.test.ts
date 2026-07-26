import { describe, it, expect, vi } from 'vitest';
import { runOperation, XplanNotLoggedInError } from './index';
import type { XplanOperation } from './playbook';

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
});
