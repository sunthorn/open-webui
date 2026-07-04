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
