import { describe, it, expect, vi } from 'vitest';
import {
	CHANGE_PASSWORD_PATH,
	changePasswordUrl,
	safeRedirect,
	isPasswordChangeRequiredResponse,
	wrapFetch
} from './passwordChange';

const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});

describe('safeRedirect', () => {
	it('keeps same-origin relative paths', () => {
		expect(safeRedirect('/c/123?x=1')).toBe('/c/123?x=1');
	});
	it('rejects absolute, protocol-relative and empty targets', () => {
		expect(safeRedirect('https://evil.example')).toBe('/');
		expect(safeRedirect('//evil.example')).toBe('/');
		expect(safeRedirect('/\\evil.example')).toBe('/');
		expect(safeRedirect(null)).toBe('/');
		expect(safeRedirect('')).toBe('/');
	});
	it('rejects targets the browser would turn into another origin', () => {
		// URL parsers drop tab/newline, so "/\t/evil" becomes "//evil".
		expect(safeRedirect('/\t/evil.example')).toBe('/');
		expect(safeRedirect('/\n/evil.example')).toBe('/');
		expect(safeRedirect('/\\/evil.example')).toBe('/');
		expect(safeRedirect('/%2F%2Fevil.example')).not.toMatch(/^\/\//);
	});
	it('rejects /auth reached through dot segments', () => {
		expect(safeRedirect('/x/../auth')).toBe('/');
	});
	it('never redirects back into the auth pages', () => {
		expect(safeRedirect(CHANGE_PASSWORD_PATH)).toBe('/');
		expect(safeRedirect('/auth?redirect=%2F')).toBe('/');
	});
});

describe('changePasswordUrl', () => {
	it('carries the original target as ?redirect=', () => {
		expect(changePasswordUrl('/c/123')).toBe(`${CHANGE_PASSWORD_PATH}?redirect=%2Fc%2F123`);
	});
	it('drops the redirect when it is just the home page or unsafe', () => {
		expect(changePasswordUrl('/')).toBe(CHANGE_PASSWORD_PATH);
		expect(changePasswordUrl('https://evil.example')).toBe(CHANGE_PASSWORD_PATH);
	});
});

describe('isPasswordChangeRequiredResponse', () => {
	it('detects the 403 marker without consuming the body', async () => {
		const res = json(403, { detail: 'PASSWORD_CHANGE_REQUIRED' });
		expect(await isPasswordChangeRequiredResponse(res)).toBe(true);
		expect(await res.json()).toEqual({ detail: 'PASSWORD_CHANGE_REQUIRED' });
	});
	it('ignores other 403s and non-403s', async () => {
		expect(await isPasswordChangeRequiredResponse(json(403, { detail: 'nope' }))).toBe(false);
		expect(
			await isPasswordChangeRequiredResponse(json(400, { detail: 'PASSWORD_CHANGE_REQUIRED' }))
		).toBe(false);
		expect(await isPasswordChangeRequiredResponse(new Response('not json', { status: 403 }))).toBe(
			false
		);
	});
});

describe('wrapFetch', () => {
	it('calls onRequired for the marker and still returns the response', async () => {
		const onRequired = vi.fn();
		const base = vi.fn(async () => json(403, { detail: 'PASSWORD_CHANGE_REQUIRED' }));
		const res = await wrapFetch(base as unknown as typeof fetch, onRequired)('/api/models');
		expect(res.status).toBe(403);
		expect(onRequired).toHaveBeenCalledTimes(1);
	});
	it('leaves ordinary responses alone', async () => {
		const onRequired = vi.fn();
		const base = vi.fn(async () => json(200, { ok: true }));
		await wrapFetch(base as unknown as typeof fetch, onRequired)('/api/models');
		expect(onRequired).not.toHaveBeenCalled();
	});
});
