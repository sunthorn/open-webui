import { WEBUI_BASE_URL } from '$lib/constants';
import type { Params, XplanOperation, BookSweepResult } from './playbook';
import { buildPrompt } from './prompt';
import { PLAYBOOK } from './playbook';
import type { XplanClient, RawBriefingItem } from './playbook';

export { type XplanClient, type RawBriefingItem, type BookSweepResult } from './playbook';

/** Thrown when XPLAN reports the browser session is not logged in. */
export class XplanNotLoggedInError extends Error {
	constructor() {
		super('NOT_LOGGED_IN');
		this.name = 'XplanNotLoggedInError';
	}
}

/**
 * Thrown when the caller cancelled the operation via its AbortSignal (the Stop
 * button), as opposed to an internal timeout. Callers should treat this as a
 * clean stop — not a red error — and NOT retry.
 */
export class XplanCancelledError extends Error {
	constructor() {
		super('CANCELLED');
		this.name = 'XplanCancelledError';
	}
}

/** Thrown when a write op is dispatched but XPLAN access is not 'full'. */
export class XplanReadOnlyError extends Error {
	constructor() {
		super('READ_ONLY');
		this.name = 'XplanReadOnlyError';
	}
}

/**
 * Thrown when hermes answered 200 but the message content is the UPSTREAM
 * provider's error text rather than the output the op asked for.
 *
 * This is not hypothetical. On 2026-09-04 hermes' config.yaml still held
 * `anthropic/claude-opus-4.6` on OpenRouter (no key), so provider "auto" fell
 * through to Gemini and Google 404'd the Anthropic model id. hermes returned
 * that 404 as the assistant's message, HTTP 200. `parsePipeTable` accepts any
 * non-empty text, so four of six sections stored
 *   [["API call failed after 3 retries: HTTP 404 ..."]]
 * as the client's financials, insurance, super and notes — each marked
 * status:"ok" with a green dot. A failed read became client data in an
 * advice system, which is worse than failing loudly.
 *
 * The parsers are the structural defence (a pipe table now requires pipes);
 * this is the backstop that covers ops whose parse is lenient by design —
 * `overview.summary` is literally `(raw) => raw`.
 */
export class XplanUpstreamError extends Error {
	constructor(detail: string) {
		super(`The model call failed upstream: ${detail}`);
		this.name = 'XplanUpstreamError';
	}
}

/**
 * Recognise a provider error envelope echoed back as message content. Matches
 * the observed shapes rather than guessing broadly — a client note legitimately
 * containing the word "error" must not be discarded as a failure.
 */
const UPSTREAM_ERROR =
	/^\s*(?:API call failed|Error code:\s*\d|An error occurred\b)|\bis not found for API version\b|'status':\s*'NOT_FOUND'/i;

/**
 * Pull a human-readable string out of an error body. The OWUI proxy / hermes
 * can return the message as a plain string (`detail`/`error`) OR as a nested
 * object (OpenAI shape `{error: {message}}`, FastAPI `{detail: {msg}}`). Passing
 * such an object to `new Error(...)` stringifies it to the useless literal
 * "[object Object]" — this digs out the actual message instead.
 */
const errMessage = (body: any, status: number): string => {
	const pick = (v: any): string | undefined => {
		if (!v) return undefined;
		if (typeof v === 'string') return v;
		if (typeof v.message === 'string') return v.message;
		if (typeof v.detail === 'string') return v.detail;
		if (typeof v.msg === 'string') return v.msg;
		return undefined;
	};
	return pick(body?.detail) ?? pick(body?.error) ?? pick(body) ?? `Request failed (HTTP ${status})`;
};

/**
 * Run one catalog operation via hermes. THE single transport for all XPLAN
 * reads: prompt from the catalog, OWUI light proxy, timeout, sentinel check,
 * fence-strip, strict parse.
 */
export const runOperation = async <T = unknown>(
	op: XplanOperation,
	token: string,
	params: Params = {},
	fetchFn: typeof fetch = fetch,
	signal?: AbortSignal,
	accessLevel?: 'lock' | 'readonly' | 'full'
): Promise<T> => {
	// Write-gate seam: a mutating op only runs at Full access. Dormant today (no
	// op sets write:true); armed for Phase-B. Default-deny when level is omitted.
	if (op.write && accessLevel !== 'full') throw new XplanReadOnlyError();
	const timeoutMs = op.timeoutMs ?? 120_000;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	// Link an external Stop signal to our internal controller so a caller can
	// abort the in-flight request. We track WHY we aborted (cancel vs timeout)
	// to surface the right outcome.
	const onCancel = () => controller.abort();
	if (signal) {
		if (signal.aborted) controller.abort();
		else signal.addEventListener('abort', onCancel, { once: true });
	}
	try {
		const res = await fetchFn(`${WEBUI_BASE_URL}/openai/chat/completions`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: 'hermes-agent',
				messages: [{ role: 'user', content: buildPrompt(op, params) }],
				stream: false
			}),
			signal: controller.signal
		});
		if (!res.ok) {
			const detail = await res.json().catch(() => ({}));
			throw new Error(errMessage(detail, res.status));
		}
		const data = await res.json();
		const raw = (data?.choices?.[0]?.message?.content ?? '').trim();
		if (raw.split('\n').some((l: string) => l.trim() === 'NOT_LOGGED_IN')) throw new XplanNotLoggedInError();
		// hermes reports an upstream model failure as a normal 200 answer, so the
		// only thing separating a failed read from a good one is the words. Check
		// BEFORE parsing: a lenient parser turns that prose into stored data.
		if (UPSTREAM_ERROR.test(raw)) throw new XplanUpstreamError(raw.slice(0, 200));
		const stripped = raw.replace(/^```(?:\w+)?\s*/i, '').replace(/\s*```$/i, '').trim();
		return op.parse(stripped) as T;
	} catch (e: any) {
		if (e?.name === 'AbortError') {
			// External Stop takes priority over the timeout race.
			if (signal?.aborted) throw new XplanCancelledError();
			throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s — is XPLAN unlocked and reachable?`);
		}
		throw e;
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', onCancel);
	}
};

// xplan-agent · Overview/Today data access (Slice 1, Stage B).
//
// These types MIRROR shared-contracts/api-responses.ts (PlannerOverview et al.).
// The open-webui Docker build context is ./open-webui only, so it cannot import
// the shared-contracts file at build time yet — keep these in sync by hand
// until a shared-types package or build-context change lands. (Infra debt,
// noted in the contract file.)
export interface PlannerTodo {
	id: string;
	title: string;
	client: string;
	due: string;
}

export interface PlannerOverview {
	counts: { tasksToday: number; reviewsDue: number; newLeads: number };
	todos: PlannerTodo[];
}

/**
 * Ask hermes to read the planner's live XPLAN dashboard and return a short
 * summary. Routes through Open WebUI's own /api/chat/completions proxy, so the
 * hermes API key never reaches the browser.
 *
 * @returns the summary text (may be `NOT_LOGGED_IN`)
 * @throws on transport / backend error
 */
export const syncXplanOverview = async (
	token: string,
	timeoutMs = 90_000,
	signal?: AbortSignal
): Promise<string> => {
	try {
		return await runOperation<string>({ ...PLAYBOOK['overview.summary'], timeoutMs }, token, {}, fetch, signal);
	} catch (e) {
		if (e instanceof XplanNotLoggedInError) return 'NOT_LOGGED_IN';
		throw e;
	}
};

// --- Live client search ---------------------------------------------------
// Search the planner's real XPLAN client book (via hermes) and return matches.
// Token-spending + browser-driven, so it's an explicit action, not per-keystroke.

/**
 * Search XPLAN clients by name via hermes.
 * @returns matches (possibly empty), or the sentinel 'NOT_LOGGED_IN'.
 */
export const searchXplanClients = async (
	token: string,
	query: string,
	timeoutMs = 120_000
): Promise<XplanClient[] | 'NOT_LOGGED_IN'> => {
	try {
		return await runOperation<XplanClient[]>({ ...PLAYBOOK['clients.search'], timeoutMs }, token, { query });
	} catch (e) {
		if (e instanceof XplanNotLoggedInError) return 'NOT_LOGGED_IN';
		throw e;
	}
};

// --- Client book sync -----------------------------------------------------
// Navigate the deterministic client-results URL (which RENDERS the list — no
// search form to operate, unlike the flaky live search) and extract the table.

/**
 * Sweep ONE batch of the client book (up to `pages` pages) from a single
 * search. `navigateFirst` starts the search (navigate once); subsequent calls
 * page the same search without navigating.
 */
export const gatherXplanClientBook = async (
	token: string,
	opts: { navigateFirst: boolean; pages: number },
	timeoutMs = 150_000,
	signal?: AbortSignal,
	fetchFn: typeof fetch = fetch
): Promise<BookSweepResult | 'NOT_LOGGED_IN'> => {
	try {
		return await runOperation<BookSweepResult>(
			{ ...PLAYBOOK['clients.bookSweep'], timeoutMs },
			token,
			{ navigateFirst: opts.navigateFirst ? 'true' : 'false', pages: String(opts.pages) },
			fetchFn,
			signal
		);
	} catch (e) {
		if (e instanceof XplanNotLoggedInError) return 'NOT_LOGGED_IN';
		throw e;
	}
};

// --- Live briefing (Build B) ----------------------------------------------
// Gather today's real tasks/diary from the logged-in XPLAN (via hermes), then
// bucket into horizons (ported from scripts/build-briefing.py compute()). This
// replaces the sample data with a live, planner-triggered read.

import type { DailyBriefing, BriefingItem } from '$lib/apis/gateway';

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const parseDue = (s?: string): Date | null => {
	if (!s) return null;
	const d = new Date(s + 'T00:00:00');
	return isNaN(d.getTime()) ? null : d;
};

/** Friendly dueAt label, mirroring the Python builder's _item(). */
const dueLabel = (due: Date | null, time: string | undefined, status: string, today: Date): string => {
	if (time && due && dayKey(due) === dayKey(today)) return time;
	if (status === 'overdue' && due) {
		const days = Math.round((today.getTime() - due.getTime()) / 86400000);
		return `${days}d ago`;
	}
	if (due) return due.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
	return '';
};

/** Bucket raw items into needsAttention / today / tomorrow / next7. */
export const computeBriefing = (raw: RawBriefingItem[], today = new Date()): DailyBriefing => {
	const needs: BriefingItem[] = [];
	const todayB: BriefingItem[] = [];
	const tomorrowB: BriefingItem[] = [];
	const next7: BriefingItem[] = [];
	const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());

	const mk = (r: RawBriefingItem, status: BriefingItem['status'], i: number, due: Date | null): BriefingItem => {
		const item: BriefingItem = {
			id: `xplan:${i}`,
			title: r.title,
			status,
			source: 'xplan',
			dueAt: dueLabel(due, r.time, status, t0)
		};
		if (r.client) item.client = r.client;
		if (r.detail) item.detail = r.detail;
		return item;
	};

	raw.forEach((r, i) => {
		const due = parseDue(r.dueAt);
		if (!due) {
			// Undated items still matter — surface them under today.
			todayB.push(mk(r, 'due', i, null));
			return;
		}
		const diff = Math.round((due.getTime() - t0.getTime()) / 86400000);
		if (r.done && diff === 0) todayB.push(mk(r, 'done', i, due));
		else if (diff < 0 && !r.done) {
			if (diff >= -7) needs.push(mk(r, 'overdue', i, due)); // roll forward ≤7 days
		} else if (diff === 0) todayB.push(mk(r, 'due', i, due));
		else if (diff === 1) tomorrowB.push(mk(r, 'upcoming', i, due));
		else if (diff > 1 && diff <= 7) next7.push(mk(r, 'upcoming', i, due));
	});

	return {
		owner: '', // the gateway keys the row by the authenticated owner
		compiledAt: new Date().toISOString(),
		sources: ['xplan'],
		needsAttention: needs,
		today: todayB,
		tomorrow: tomorrowB,
		next7
	};
};

/**
 * Read today's tasks/diary live from XPLAN via hermes and return raw items.
 * @returns raw items (possibly empty), or throws; special value 'NOT_LOGGED_IN'.
 */
export const gatherXplanBriefing = async (
	token: string,
	timeoutMs = 120_000,
	signal?: AbortSignal
): Promise<RawBriefingItem[] | 'NOT_LOGGED_IN'> => {
	try {
		return await runOperation<RawBriefingItem[]>(
			{ ...PLAYBOOK['briefing.gather'], timeoutMs },
			token,
			{},
			fetch,
			signal
		);
	} catch (e) {
		if (e instanceof XplanNotLoggedInError) return 'NOT_LOGGED_IN';
		throw e;
	}
};
