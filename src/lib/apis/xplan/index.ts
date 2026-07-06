import { WEBUI_BASE_URL } from '$lib/constants';

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

// Constrained prompt: a single navigate + short text summary. Verified to run
// in ~15s and stay stable. Deliberately forbids snapshot/cdp/execute_code and
// looping — those make the agent thrash on XPLAN's heavy dashboard and can OOM
// the backend.
const XPLAN_SUMMARY_PROMPT = [
	'You are connected to a browser already logged in to XPLAN (IRESS financial',
	'planning software) for a financial planner.',
	'',
	'Do EXACTLY this and nothing more: call browser_navigate once to',
	'https://sparkfg.xplan.iress.com.au/dashboard/mainhtml , then give a SHORT',
	'plain-text summary (max 6 bullet lines, start each line with "- ") of what',
	'the planner has on their dashboard — e.g. recent clients and any diary /',
	'appointment / outstanding-task items.',
	'',
	'Do NOT use browser_cdp, execute_code, or browser_snapshot. Do not loop.',
	'Keep it brief. If you are not logged in, reply exactly: NOT_LOGGED_IN'
].join('\n');

/**
 * Ask hermes to read the planner's live XPLAN dashboard and return a short
 * summary. Routes through Open WebUI's own /api/chat/completions proxy, so the
 * hermes API key never reaches the browser.
 *
 * @returns the summary text (may be `NOT_LOGGED_IN`)
 * @throws on transport / backend error
 */
export const syncXplanOverview = async (token: string, timeoutMs = 90_000): Promise<string> => {
	// Hit OWUI's LIGHT direct proxy (/openai/chat/completions) rather than the
	// heavy /api/chat/completions pipeline (which also fires title/tag/follow-up
	// model calls against the slow agent — multiplying latency). Add a hard
	// timeout so a stalled backend fails fast instead of spinning forever.
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(`${WEBUI_BASE_URL}/openai/chat/completions`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: 'hermes-agent',
				messages: [{ role: 'user', content: XPLAN_SUMMARY_PROMPT }],
				stream: false
			}),
			signal: controller.signal
		});
		if (!res.ok) {
			const detail = await res.json().catch(() => ({}));
			throw new Error(detail?.detail ?? detail?.error ?? `HTTP ${res.status}`);
		}
		const data = await res.json();
		return (data?.choices?.[0]?.message?.content ?? '').trim();
	} catch (e: any) {
		if (e?.name === 'AbortError') {
			throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s — is XPLAN unlocked and reachable?`);
		}
		throw e;
	} finally {
		clearTimeout(timer);
	}
};

// --- Live client search ---------------------------------------------------
// Search the planner's real XPLAN client book (via hermes) and return matches.
// Token-spending + browser-driven, so it's an explicit action, not per-keystroke.

export interface XplanClient {
	name: string;
	id: string; // XPLAN entity id if extractable, else ''
}

const clientSearchPrompt = (query: string): string =>
	[
		'You are connected to a browser already logged in to XPLAN (IRESS financial',
		'planning software) for a financial planner.',
		'',
		`Find clients whose name matches "${query}".`,
		'Use the client search (the Clients search under factfind — e.g.',
		'https://sparkfg.xplan.iress.com.au/factfind/search/result?role=client ),',
		`enter "${query}" as the name/keyword, run the search, and read the results.`,
		'',
		'Return STRICT JSON ONLY (no prose, no code fences): an array of up to 25',
		'matches, each {"name":"<display name>","id":"<entity id from the row link, or empty>"}.',
		`Only include clients whose name actually matches "${query}". If none, return: []`,
		'If you are not logged in, reply exactly: NOT_LOGGED_IN',
		'Do not open individual client pages. Keep it to a single search; do not loop.'
	].join('\n');

/**
 * Search XPLAN clients by name via hermes.
 * @returns matches (possibly empty), or the sentinel 'NOT_LOGGED_IN'.
 */
export const searchXplanClients = async (
	token: string,
	query: string,
	timeoutMs = 120_000
): Promise<XplanClient[] | 'NOT_LOGGED_IN'> => {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(`${WEBUI_BASE_URL}/openai/chat/completions`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: 'hermes-agent',
				messages: [{ role: 'user', content: clientSearchPrompt(query) }],
				stream: false
			}),
			signal: controller.signal
		});
		if (!res.ok) {
			const detail = await res.json().catch(() => ({}));
			throw new Error(detail?.detail ?? detail?.error ?? `HTTP ${res.status}`);
		}
		const data = await res.json();
		const raw = (data?.choices?.[0]?.message?.content ?? '').trim();
		if (raw.includes('NOT_LOGGED_IN')) return 'NOT_LOGGED_IN';
		const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
		let parsed: unknown;
		try {
			parsed = JSON.parse(jsonText);
		} catch {
			throw new Error('XPLAN returned an unexpected format while searching. Try again.');
		}
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
			.map((c) => ({ name: String(c.name ?? '').trim(), id: String(c.id ?? '') }))
			.filter((c) => c.name.length > 0);
	} catch (e: any) {
		if (e?.name === 'AbortError') throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s searching XPLAN.`);
		throw e;
	} finally {
		clearTimeout(timer);
	}
};

// --- Client book sync -----------------------------------------------------
// Navigate the deterministic client-results URL (which RENDERS the list — no
// search form to operate, unlike the flaky live search) and extract the table.
// Single page for now (~100 rows); pagination added once extraction is proven.

const CLIENT_BOOK_PROMPT = [
	'You are connected to a browser already logged in to XPLAN (IRESS) for a',
	'financial planner.',
	'',
	'Do EXACTLY this: call browser_navigate ONCE to',
	'https://sparkfg.xplan.iress.com.au/factfind/search/result?role=client',
	'then read the CLIENT RESULTS TABLE on that page.',
	'',
	'Return STRICT JSON ONLY (no prose, no code fences): an array of the client',
	'rows visible on this page, each {"name":"<display name>","id":"<entity id',
	'from the row link href if present, else empty>"}. Include every row (up to ~100).',
	'',
	'If you are not logged in, reply exactly: NOT_LOGGED_IN',
	'Do NOT paginate, do NOT open client pages, do NOT use browser_cdp /',
	'execute_code / browser_snapshot. Do not loop.'
].join('\n');

/**
 * Sync one page of the XPLAN client book via hermes.
 * @returns client rows (possibly empty), or the sentinel 'NOT_LOGGED_IN'.
 */
export const gatherXplanClientPage = async (
	token: string,
	timeoutMs = 120_000
): Promise<XplanClient[] | 'NOT_LOGGED_IN'> => {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(`${WEBUI_BASE_URL}/openai/chat/completions`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: 'hermes-agent',
				messages: [{ role: 'user', content: CLIENT_BOOK_PROMPT }],
				stream: false
			}),
			signal: controller.signal
		});
		if (!res.ok) {
			const detail = await res.json().catch(() => ({}));
			throw new Error(detail?.detail ?? detail?.error ?? `HTTP ${res.status}`);
		}
		const data = await res.json();
		const raw = (data?.choices?.[0]?.message?.content ?? '').trim();
		if (raw.includes('NOT_LOGGED_IN')) return 'NOT_LOGGED_IN';
		const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
		let parsed: unknown;
		try {
			parsed = JSON.parse(jsonText);
		} catch {
			throw new Error('XPLAN returned an unexpected format while syncing clients. Try again.');
		}
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
			.map((c) => ({ name: String(c.name ?? '').trim(), id: String(c.id ?? '') }))
			.filter((c) => c.name.length > 0);
	} catch (e: any) {
		if (e?.name === 'AbortError') throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s syncing clients.`);
		throw e;
	} finally {
		clearTimeout(timer);
	}
};

// --- Live briefing (Build B) ----------------------------------------------
// Gather today's real tasks/diary from the logged-in XPLAN (via hermes), then
// bucket into horizons (ported from scripts/build-briefing.py compute()). This
// replaces the sample data with a live, planner-triggered read.

import type { DailyBriefing, BriefingItem } from '$lib/apis/gateway';

export interface RawBriefingItem {
	title: string;
	client?: string;
	detail?: string;
	dueAt?: string; // ISO 'YYYY-MM-DD' or ''
	time?: string; // 'HH:MM' or ''
	done?: boolean;
}

const XPLAN_BRIEFING_PROMPT = [
	'You are connected to a browser already logged in to XPLAN (IRESS financial',
	'planning software) for a financial planner.',
	'',
	'Do EXACTLY this and nothing more: call browser_navigate once to',
	'https://sparkfg.xplan.iress.com.au/dashboard/mainhtml , then read the',
	"planner's TASKS, DIARY / APPOINTMENTS and REVIEWS that are visible on the",
	'page.',
	'',
	'Return STRICT JSON ONLY (no prose, no code fences): an array of items, each:',
	'{"title":"...","client":"name or empty","dueAt":"YYYY-MM-DD or empty",',
	'"time":"HH:MM or empty","done":false,"detail":""}',
	'',
	'Include only items actually visible. If none are visible, return exactly: []',
	'If you are not logged in, reply exactly: NOT_LOGGED_IN',
	'Do NOT use browser_cdp, execute_code, or browser_snapshot. Do not loop.'
].join('\n');

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
export const gatherXplanBriefing = async (token: string, timeoutMs = 120_000): Promise<RawBriefingItem[] | 'NOT_LOGGED_IN'> => {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(`${WEBUI_BASE_URL}/openai/chat/completions`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: 'hermes-agent',
				messages: [{ role: 'user', content: XPLAN_BRIEFING_PROMPT }],
				stream: false
			}),
			signal: controller.signal
		});
		if (!res.ok) {
			const detail = await res.json().catch(() => ({}));
			throw new Error(detail?.detail ?? detail?.error ?? `HTTP ${res.status}`);
		}
		const data = await res.json();
		const rawText = (data?.choices?.[0]?.message?.content ?? '').trim();
		if (rawText.includes('NOT_LOGGED_IN')) return 'NOT_LOGGED_IN';
		const jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
		let parsed: unknown;
		try {
			parsed = JSON.parse(jsonText);
		} catch {
			throw new Error('XPLAN returned an unexpected format while reading tasks. Try again.');
		}
		return Array.isArray(parsed) ? (parsed as RawBriefingItem[]) : [];
	} catch (e: any) {
		if (e?.name === 'AbortError') throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s reading XPLAN tasks.`);
		throw e;
	} finally {
		clearTimeout(timer);
	}
};
