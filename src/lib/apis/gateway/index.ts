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
