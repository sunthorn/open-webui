// Client for the data-layer via the contact-layer gateway.
// The browser talks ONLY to the gateway; it verifies the OWUI session token
// (sent as Bearer) with security-layer and derives `owner` server-side.
//
// GATEWAY_URL: dev = same host, port 8200. TODO(prod): make this configurable
// / serve the gateway same-origin behind a reverse proxy so this isn't hard-set.
const GATEWAY_URL = 'http://localhost:8200';

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
	const res = await fetch(`${GATEWAY_URL}/gw/outputs/briefing:daily`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (res.status === 404) return null; // not built yet
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(body?.detail ?? `Gateway error (${res.status})`);
	}
	const body = await res.json(); // { success, data: AgentOutput }
	return (body?.data?.content ?? null) as DailyBriefing | null;
};

// --- New Client Onboarding sessions ---------------------------------------
// Persisted so the planner can leave the review and return. Stored as one
// AgentOutput per session at key `onboarding:{sessionId}`.

/** Load a saved onboarding session, or null if none exists yet. */
export const getOnboardingSession = async (token: string, sessionId: string): Promise<any | null> => {
	const res = await fetch(`${GATEWAY_URL}/gw/outputs/onboarding:${sessionId}`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (res.status === 404) return null;
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(body?.detail ?? `Gateway error (${res.status})`);
	}
	return (await res.json())?.data?.content ?? null;
};

/** Upsert an onboarding session. `session` is the OnboardingSession content. */
export const saveOnboardingSession = async (token: string, sessionId: string, session: any): Promise<void> => {
	const res = await fetch(`${GATEWAY_URL}/gw/outputs/onboarding:${sessionId}`, {
		method: 'PUT',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ kind: 'onboarding_session', content: session })
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(body?.detail ?? `Gateway error (${res.status})`);
	}
};

// --- XPLAN guardrail (browser access on/off) -----------------------------
// locked === true  → hermes cannot open/read/write XPLAN.

export const getGuardrail = async (token: string): Promise<boolean> => {
	const res = await fetch(`${GATEWAY_URL}/gw/guardrail`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (!res.ok) throw new Error(`Gateway error (${res.status})`);
	return !!(await res.json()).locked;
};

export const setGuardrail = async (token: string, locked: boolean): Promise<boolean> => {
	const res = await fetch(`${GATEWAY_URL}/gw/guardrail`, {
		method: 'PUT',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ locked })
	});
	if (!res.ok) throw new Error(`Gateway error (${res.status})`);
	return !!(await res.json()).locked;
};
