// Client for the data-layer via the contact-layer gateway.
// The browser talks ONLY to the gateway; it verifies the OWUI session token
// (sent as Bearer) with security-layer and derives `owner` server-side.
//
// Same-origin: axi's Caddy front door proxies /gw/* to contact-layer:8200
// (gateway/Caddyfile). This used to be an absolute http://<hostname>:8200 URL,
// which became cross-origin once OWUI moved behind the gateway — contact-layer
// scopes CORS to the OWUI origin, so every /gw call was rejected in the
// browser and the XPLAN status pill disappeared from the apps top bar.
//
// Keeping it relative also means contact-layer needs no published host port:
// the only way to reach XPLAN is through axi, which is the rule we want.
const gatewayUrl = () => '';

/** A failed gateway call, carrying the status so callers can branch on it. */
export class GatewayError extends Error {
	/** HTTP status, so callers can tell 503 "sign in again" from a real fault. */
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = 'GatewayError';
		this.status = status;
	}
}

/**
 * Turn a failed response into an Error a planner can read.
 *
 * `body?.detail` is NOT always a string. contact-layer raises its own errors
 * with a string detail, but anything it forwards from data-layer arrives
 * wrapped by envelope.error() as
 *   {"detail": {"success": false, "error": {"code", "message"}}}
 * — and `throw new Error(body?.detail ?? …)` on that object renders the
 * literal text "[object Object]" in the UI, which names no cause and offers
 * no next step. Dig out the message; fall back to the status code, never to
 * a stringified object.
 */
const gatewayError = async (res: Response): Promise<GatewayError> => {
	const body: any = await res.json().catch(() => ({}));
	const d = body?.detail;
	const text =
		typeof d === 'string'
			? d
			: typeof d?.error?.message === 'string'
				? d.error.message
				: typeof d?.message === 'string'
					? d.message
					: typeof body?.error?.message === 'string'
						? body.error.message
						: '';
	return new GatewayError(text.trim() || `Gateway error (${res.status})`, res.status);
};

// Mirrors shared-contracts/api-responses.ts (DailyBriefing). Kept local until
// the shared-types build-context gap is resolved — must stay in sync.
export type BriefingStatus = 'overdue' | 'due' | 'upcoming' | 'done';

export interface BriefingItem {
	id: string;
	title: string;
	client?: string;
	detail?: string;
	dueAt?: string;
	status: BriefingStatus;
	source: string;
	href?: string;
}

export interface DailyBriefing {
	owner: string;
	compiledAt: string;
	sources: string[];
	needsAttention: BriefingItem[];
	today: BriefingItem[];
	tomorrow: BriefingItem[];
	next7: BriefingItem[];
}

/** GET the planner's daily briefing. Returns null if none has been built yet. */
export const getBriefing = async (token: string): Promise<DailyBriefing | null> => {
	const res = await fetch(`${gatewayUrl()}/gw/outputs/briefing:daily`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (res.status === 404) return null; // not built yet
	if (!res.ok) {
		throw await gatewayError(res);
	}
	const body = await res.json(); // { success, data: AgentOutput }
	return (body?.data?.content ?? null) as DailyBriefing | null;
};

/** Upsert the planner's daily briefing (used by the live "Refresh from XPLAN"). */
export const saveBriefing = async (token: string, briefing: DailyBriefing): Promise<void> => {
	const res = await fetch(`${gatewayUrl()}/gw/outputs/briefing:daily`, {
		method: 'PUT',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ kind: 'briefing', content: briefing })
	});
	if (!res.ok) {
		throw await gatewayError(res);
	}
};

// --- XPLAN connection status (cheap, token-free) --------------------------
// Probes the debug Chrome via the gateway (no LLM/hermes call). Lets the
// planner verify the connection without spending tokens; the actual dashboard
// sync stays a separate, explicit action.

export interface XplanStatus {
	browserUp: boolean;
	loggedIn: boolean | null; // null = browser up but can't tell (no XPLAN tab)
	tabUrl?: string | null;
	/** Whether the host caretaker answers /health. Absent on an older gateway. */
	helper?: 'running' | 'not-installed';
}

export const getXplanStatus = async (token: string): Promise<XplanStatus> => {
	const res = await fetch(`${gatewayUrl()}/gw/xplan/status`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (!res.ok) throw new Error(`Gateway error (${res.status})`);
	return (await res.json()) as XplanStatus;
};

// --- Overview snapshot (last XPLAN sync) ----------------------------------
// Persist the last "Sync from XPLAN" result so the Overview reloads it on
// visit instead of forcing the planner to re-run the (slow) live sync.

export interface OverviewSnapshot {
	lines: string[];
	notLoggedIn: boolean;
	syncedAt: string; // ISO 8601
}

/** Load the last saved Overview snapshot, or null if none exists yet. */
export const getOverviewSnapshot = async (token: string): Promise<OverviewSnapshot | null> => {
	const res = await fetch(`${gatewayUrl()}/gw/outputs/overview:xplan`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (res.status === 404) return null;
	if (!res.ok) {
		throw await gatewayError(res);
	}
	return ((await res.json())?.data?.content ?? null) as OverviewSnapshot | null;
};

/** Save the latest Overview snapshot. */
export const saveOverviewSnapshot = async (token: string, snapshot: OverviewSnapshot): Promise<void> => {
	const res = await fetch(`${gatewayUrl()}/gw/outputs/overview:xplan`, {
		method: 'PUT',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ kind: 'overview_snapshot', content: snapshot })
	});
	if (!res.ok) {
		throw await gatewayError(res);
	}
};

// --- Generic agent-output access ------------------------------------------
// For surfaces that just need to read/write a keyed JSON document (e.g. leads).

export const getOutput = async <T = unknown>(token: string, key: string): Promise<T | null> => {
	const res = await fetch(`${gatewayUrl()}/gw/outputs/${key}`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (res.status === 404) return null;
	if (!res.ok) {
		throw await gatewayError(res);
	}
	return ((await res.json())?.data?.content ?? null) as T | null;
};

export const putOutput = async (token: string, key: string, kind: string, content: unknown): Promise<void> => {
	const res = await fetch(`${gatewayUrl()}/gw/outputs/${key}`, {
		method: 'PUT',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ kind, content })
	});
	if (!res.ok) {
		throw await gatewayError(res);
	}
};

// --- New Client Onboarding sessions ---------------------------------------
// Persisted so the planner can leave the review and return. Stored as one
// AgentOutput per session at key `onboarding:{sessionId}`.

/** Load a saved onboarding session, or null if none exists yet. */
export const getOnboardingSession = async (token: string, sessionId: string): Promise<any | null> => {
	const res = await fetch(`${gatewayUrl()}/gw/outputs/onboarding:${sessionId}`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (res.status === 404) return null;
	if (!res.ok) {
		throw await gatewayError(res);
	}
	return (await res.json())?.data?.content ?? null;
};

/** Upsert an onboarding session. `session` is the OnboardingSession content. */
export const saveOnboardingSession = async (token: string, sessionId: string, session: any): Promise<void> => {
	const res = await fetch(`${gatewayUrl()}/gw/outputs/onboarding:${sessionId}`, {
		method: 'PUT',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ kind: 'onboarding_session', content: session })
	});
	if (!res.ok) {
		throw await gatewayError(res);
	}
};

// --- XPLAN guardrail (browser access on/off) -----------------------------
// locked === true  → hermes cannot open/read/write XPLAN.
//
// Nothing in the UI calls these any more, and new code should not: `locked` is
// only the `lock` tier of the three the gateway derives, so this pair cannot
// tell Read-only from Full, and PUTting locked=false silently resets the mode to
// read-only. Use getXplanAccess/setXplanAccess below — same state, all three
// tiers, and one writer. Kept because the endpoints are still live and the
// contact-layer tests exercise them.

export const getGuardrail = async (token: string): Promise<boolean> => {
	const res = await fetch(`${gatewayUrl()}/gw/guardrail`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (!res.ok) throw new Error(`Gateway error (${res.status})`);
	return !!(await res.json()).locked;
};

export const setGuardrail = async (token: string, locked: boolean): Promise<boolean> => {
	const res = await fetch(`${gatewayUrl()}/gw/guardrail`, {
		method: 'PUT',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ locked })
	});
	if (!res.ok) throw new Error(`Gateway error (${res.status})`);
	return !!(await res.json()).locked;
};

// --- Debug-Chrome caretaker (keep alive / reopen) -------------------------
// A host-side watcher keeps the debug Chrome alive WHILE axi is open. The app
// sends a heartbeat every ~30s (fire-and-forget); the "Reopen" button asks the
// caretaker to force-restart the debug Chrome. PUT to match the gateway's CORS
// method allowlist.

/** Tell the caretaker "axi is open, keep the debug Chrome alive". Never throws —
 *  a missing caretaker is not a UI error; the connection badge speaks for itself. */
export const sendXplanHeartbeat = async (token: string): Promise<void> => {
	try {
		await fetch(`${gatewayUrl()}/gw/xplan/heartbeat`, {
			method: 'PUT',
			headers: { Authorization: `Bearer ${token}` }
		});
	} catch {
		/* offline / caretaker down — ignore; the badge reflects reality */
	}
};

/** Force the caretaker to reopen the debug Chrome (the in-app backup button).
 *  Throws with a readable message if the caretaker isn't installed/reachable. */
export const relaunchDebugBrowser = async (token: string): Promise<void> => {
	const res = await fetch(`${gatewayUrl()}/gw/xplan/relaunch`, {
		method: 'PUT',
		headers: { Authorization: `Bearer ${token}` }
	});
	if (!res.ok) {
		throw await gatewayError(res);
	}
};

/** Open an XPLAN page in the DEBUG browser (where the planner is signed in) —
 *  a plain link would open in this browser and land on a login page.
 *  `path` is site-relative, e.g. '/xtasks/framelist/todo'. */
export const openInXplan = async (token: string, path: string): Promise<void> => {
	const res = await fetch(`${gatewayUrl()}/gw/xplan/open`, {
		method: 'PUT',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ path })
	});
	if (!res.ok) {
		throw await gatewayError(res);
	}
};

/** One row of the client book, as the scripted sweep returns it. */
export interface SweptClient {
	/** The INDIVIDUAL client id (the row checkbox value). Unique per person. */
	id: string;
	/** The HOUSEHOLD id. Shared by couples — never dedupe on this. */
	householdId: string;
	name: string;
}

export interface BookSweepResponse {
	total: number;
	collected: number;
	pages: number;
	complete: boolean;
	rows: SweptClient[];
}

/**
 * Read the WHOLE client book deterministically — no LLM, no tokens, ~6s.
 *
 * The agent path cannot do this at all: the rows live in a same-origin iframe
 * and hermes' browser_snapshot does not descend into iframes, so the model is
 * shown nav chrome and honestly answers "no rows". contact-layer runs a fixed,
 * reviewed script in the page over CDP instead. See BACKLOG.md.
 *
 * A 503 means the browser or XPLAN session is not ready (not signed in, tab
 * closed) — worth surfacing differently from a real failure.
 */
export const sweepClientBook = async (token: string): Promise<BookSweepResponse> => {
	const res = await fetch(`${gatewayUrl()}/gw/xplan/book-sweep`, {
		method: 'PUT',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
	});
	if (!res.ok) {
		throw await gatewayError(res);
	}
	return await res.json();
};

// --- XPLAN access tiers (Lock / Read-only / Full) -------------------------
export type XplanAccessLevel = 'lock' | 'readonly' | 'full';

/** Pure tier → display mapping (unit-testable; used by the chip + overview). */
export const accessMeta = (level: XplanAccessLevel) =>
	({
		lock: { icon: '🔒', label: 'Lock', isLock: true, canWrite: false },
		readonly: { icon: '👁', label: 'Read-only', isLock: false, canWrite: false },
		full: { icon: '✍️', label: 'Full', isLock: false, canWrite: true }
	})[level];

export const getXplanAccess = async (token: string): Promise<XplanAccessLevel> => {
	const res = await fetch(`${gatewayUrl()}/gw/xplan/access`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (!res.ok) throw new Error(`Gateway error (${res.status})`);
	return (await res.json()).level as XplanAccessLevel;
};

export const setXplanAccess = async (token: string, level: XplanAccessLevel): Promise<XplanAccessLevel> => {
	const res = await fetch(`${gatewayUrl()}/gw/xplan/access`, {
		method: 'PUT',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ level })
	});
	if (!res.ok) throw new Error(`Gateway error (${res.status})`);
	return (await res.json()).level as XplanAccessLevel;
};

// --- The firm's XPLAN client store (Tasks 3-13) ---------------------------
//
// Three firm-scoped Postgres tables served by /gw/clients, filled by the
// deterministic scraper — NOT the per-user `agent_output` blob the legacy
// client book and `client:{id}` detail still use. Firm-scoped is the point:
// this data belongs to the practice, so nothing here is keyed by OWUI user.
//
// Types mirror shared-contracts/api-responses.ts (XplanSectionStatus,
// XplanClientRecord, XplanClientSection) field for field. They are copied,
// not imported, for the same reason DailyBriefing above is: open-webui's
// Docker build context is ./open-webui, so ../shared-contracts is not
// reachable at build time. Must stay in sync — do not let them diverge.

export type XplanSectionStatus = 'ok' | 'empty' | 'changed' | 'error';

export interface XplanClientRecord {
	xplanClientId: string;
	xplanHouseholdId: string | null;
	name: string;
	syncedAt: string;
	deepSyncedAt: string | null;
}

export interface XplanClientSection {
	section: string; // e.g. 'balancesheet'
	pageId: string; // the XPLAN page= value
	fetchedViaId: string; // which id produced this — person or household
	status: XplanSectionStatus;
	mapVersion: number | null;
	structureHash: string | null;
	headers: string[];
	/** Header-keyed, e.g. {"Description": "Home"} — NOT a positional array. */
	rows: Record<string, string>[];
	unmapped: Record<string, unknown>;
	fetchedAt: string;
}

/**
 * Mirrors `XplanClientPage` in shared-contracts/api-responses.ts — kept local
 * for the same reason the types above it are (the Docker build context is
 * ./open-webui, so ../shared-contracts is unreachable at build time). Must
 * stay in sync; do not let them diverge.
 *
 * `total`/`limit`/`offset` are optional ONLY to tolerate an older gateway
 * that predates paging. Against a current one they are always present.
 */
export interface ClientListResponse {
	clients: XplanClientRecord[];
	/** Rows in THIS page. */
	count: number;
	/** Rows matching the query across the whole book — how a caller knows
	 *  whether it has all of them. */
	total?: number;
	limit?: number;
	offset?: number;
}

export interface ClientDetailResponse {
	client: XplanClientRecord;
	sections: XplanClientSection[];
}

/**
 * ONE PAGE of the firm's synced book. Local read — no XPLAN, no tokens.
 *
 * The store caps `limit` at 1000 and the book is well past that, so a single
 * call cannot return it whatever the limit. Use `listAllClients` below unless
 * you genuinely want one page.
 */
export const listClients = async (
	token: string,
	q = '',
	limit = 1000,
	offset = 0
): Promise<ClientListResponse> => {
	const params = new URLSearchParams({
		q,
		limit: String(limit),
		offset: String(offset)
	});
	const res = await fetch(`${gatewayUrl()}/gw/clients?${params}`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (!res.ok) throw await gatewayError(res);
	return await res.json();
};

/** Pages requested per call — the store's hard ceiling on `limit`. */
const CLIENT_PAGE_SIZE = 1000;
/** Refuses to loop forever if a gateway ever stops advancing. 20k clients. */
const CLIENT_PAGE_CAP = 20;

/**
 * The WHOLE book, paged until it is complete.
 *
 * The retired per-user blob held every row, so the Clients page listing 200
 * of 4817 was a regression, not a limitation — and a silent one: a short
 * list looks exactly like a small firm. It also weakened the shrink guard,
 * which compares a fresh sweep against `book`; comparing 4817 swept rows
 * against a 200-row `book` made that check meaningless.
 *
 * Stops when a page comes back short, when `total` says it has everything,
 * or at the cap. Errors propagate — a partial book must never be presented
 * as the whole one.
 */
export const listAllClients = async (token: string, q = ''): Promise<ClientListResponse> => {
	const clients: XplanClientRecord[] = [];
	let total: number | undefined;

	for (let page = 0; page < CLIENT_PAGE_CAP; page++) {
		const res = await listClients(token, q, CLIENT_PAGE_SIZE, clients.length);
		total = res.total ?? total;
		clients.push(...res.clients);
		if (res.clients.length < CLIENT_PAGE_SIZE) break;
		if (total !== undefined && clients.length >= total) break;
	}

	return { clients, count: clients.length, total: total ?? clients.length };
};

/** One client and every stored section. Null when the client isn't in the book. */
export const getClientDetail = async (
	token: string,
	clientId: string
): Promise<ClientDetailResponse | null> => {
	const res = await fetch(`${gatewayUrl()}/gw/clients/${encodeURIComponent(clientId)}`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (res.status === 404) return null;
	if (!res.ok) throw await gatewayError(res);
	return await res.json();
};

export interface DeepSyncResult {
	clientId: string;
	sectionsRead: number;
	sectionsStored: number;
	storeFailures: number;
	deepSyncedStamped: boolean;
	idsUsed: string[];
	missingPanels: { section: string; fetchedViaId: string; missing: string[] }[];
}

/**
 * Scripted deep sync for ONE client: 23 pages, seconds, no tokens.
 *
 * Deterministic — a reviewed script run in the page over CDP, not a model
 * reading a screenshot. Reads only; XPLAN is never written to.
 *
 * A 503 means the XPLAN session expired or the debug browser is unreachable.
 * That is "sign in again", not "report a bug" — catch GatewayError and check
 * `.status` rather than showing it as a generic failure. 403 means the XPLAN
 * access tier is set to Lock.
 */
export const deepSyncClient = async (token: string, clientId: string): Promise<DeepSyncResult> => {
	const res = await fetch(`${gatewayUrl()}/gw/clients/${encodeURIComponent(clientId)}/sync`, {
		method: 'PUT',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
	});
	if (!res.ok) throw await gatewayError(res);
	return await res.json();
};

export interface BookSyncResponse {
	swept: number;
	upserted: number;
	total?: number;
	pages?: number;
	complete: boolean;
	/** Present only when the sweep returned nothing — says why. */
	reason?: string;
	/** The swept rows, same shape as sweepClientBook()'s. Empty on `reason`. */
	rows?: SweptClient[];
}

/**
 * Sweep the whole book and upsert it into the firm's client store — ONE pass.
 *
 * Replaces sweepClientBook() as the clients page's sync. Both sweep XPLAN
 * identically; this one additionally upserts server-side and hands the rows
 * back, so the legacy `agent_output` book can be rebuilt from the SAME read.
 * Calling both would mean two CDP sweeps by two writers that can disagree.
 *
 * 503 = session expired / browser unreachable ("sign in again"); 403 = Lock.
 */
export const syncClientBook = async (token: string): Promise<BookSyncResponse> => {
	const res = await fetch(`${gatewayUrl()}/gw/clients/sync`, {
		method: 'PUT',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
	});
	if (!res.ok) throw await gatewayError(res);
	return await res.json();
};
