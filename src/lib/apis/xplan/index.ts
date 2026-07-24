import { WEBUI_BASE_URL } from '$lib/constants';
import type { Params, XplanOperation } from './playbook';
import { buildPrompt } from './prompt';
import { PLAYBOOK } from './playbook';
import type { XplanClient, ClientPage, RawBriefingItem } from './playbook';

export { type XplanClient, type ClientPage, type RawBriefingItem } from './playbook';

/** Thrown when XPLAN reports the browser session is not logged in. */
export class XplanNotLoggedInError extends Error {
	constructor() {
		super('NOT_LOGGED_IN');
		this.name = 'XplanNotLoggedInError';
	}
}

/**
 * Run one catalog operation via hermes. THE single transport for all XPLAN
 * reads: prompt from the catalog, OWUI light proxy, timeout, sentinel check,
 * fence-strip, strict parse.
 */
export const runOperation = async <T = unknown>(
	op: XplanOperation,
	token: string,
	params: Params = {},
	fetchFn: typeof fetch = fetch
): Promise<T> => {
	const timeoutMs = op.timeoutMs ?? 120_000;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
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
			throw new Error((detail as any)?.detail ?? (detail as any)?.error ?? `HTTP ${res.status}`);
		}
		const data = await res.json();
		const raw = (data?.choices?.[0]?.message?.content ?? '').trim();
		if (raw.includes('NOT_LOGGED_IN')) throw new XplanNotLoggedInError();
		const stripped = raw.replace(/^```(?:\w+)?\s*/i, '').replace(/\s*```$/i, '').trim();
		return op.parse(stripped) as T;
	} catch (e: any) {
		if (e?.name === 'AbortError') {
			throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s — is XPLAN unlocked and reachable?`);
		}
		throw e;
	} finally {
		clearTimeout(timer);
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
export const syncXplanOverview = async (token: string, timeoutMs = 90_000): Promise<string> => {
	try {
		return await runOperation<string>({ ...PLAYBOOK['overview.summary'], timeoutMs }, token);
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
 * Sync ONE page of the XPLAN client book via hermes.
 * @returns { total, rows }, or the sentinel 'NOT_LOGGED_IN'.
 */
export const gatherXplanClientPage = async (
	token: string,
	page = 1,
	timeoutMs = 120_000
): Promise<ClientPage | 'NOT_LOGGED_IN'> => {
	try {
		return await runOperation<ClientPage>({ ...PLAYBOOK['clients.bookPage'], timeoutMs }, token, {
			page: String(page)
		});
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
	timeoutMs = 120_000
): Promise<RawBriefingItem[] | 'NOT_LOGGED_IN'> => {
	try {
		return await runOperation<RawBriefingItem[]>({ ...PLAYBOOK['briefing.gather'], timeoutMs }, token);
	} catch (e) {
		if (e instanceof XplanNotLoggedInError) return 'NOT_LOGGED_IN';
		throw e;
	}
};
