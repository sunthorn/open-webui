// Agenda aggregator + connector client. Mirrors shared-contracts/api-responses.ts
// (Agenda*, ConnectorStatus) — copied, not imported, for the same build-context
// reason as the other gateway types; must stay in sync.
import { gatewayUrl, gatewayError } from './index';

export type AgendaSource = 'xplan' | 'm365' | 'google';
export type ClientVia = 'rule' | 'agent' | 'pin';
export type ConnectorProvider = 'm365' | 'google';

export interface AgendaClientRef {
	id: string;
	name: string;
	via: ClientVia;
	confidence?: number;
}

export interface AgendaEvent {
	id: string;
	source: AgendaSource;
	sourceId: string;
	title: string;
	startAt: string;
	endAt: string;
	allDay: boolean;
	location?: string;
	attendees: { name?: string; email?: string }[];
	client?: AgendaClientRef;
	href: string;
	writable: boolean;
}

export interface AgendaTask {
	id: string;
	source: AgendaSource;
	sourceId: string;
	title: string;
	dueAt?: string;
	status: 'open' | 'done' | 'overdue';
	client?: AgendaClientRef;
	suggestion?: { clientId: string; name: string; confidence: number };
	detail?: string;
	href: string;
	writable: boolean;
}

export interface AgendaSourceStatus {
	status: 'ok' | 'error' | 'disconnected' | 'locked';
	message?: string;
	readAt?: string;
}

export interface AgendaResponse {
	from: string;
	to: string;
	compiledAt: string;
	events: AgendaEvent[];
	tasks: AgendaTask[];
	sources: Record<AgendaSource, AgendaSourceStatus>;
}

export interface ConnectorStatus {
	status: 'ok' | 'reauth' | 'revoked' | 'disconnected';
	email?: string;
}
export type ConnectorsResponse = Record<ConnectorProvider, ConnectorStatus>;

export interface AgendaPin {
	source: AgendaSource;
	sourceId: string;
	clientId: string;
	verdict: 'match' | 'suggest' | 'reject';
	confirmedBy: 'rule' | 'agent' | 'planner';
	confidence?: number | null;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Local calendar date as YYYY-MM-DD — never toISOString(), which is UTC. */
export const isoDate = (d: Date): string => {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const getAgenda = async (
	token: string,
	from: string,
	to: string,
	refresh = false
): Promise<AgendaResponse> => {
	const q = new URLSearchParams({ from, to });
	if (refresh) q.set('refresh', '1');
	const res = await fetch(`${gatewayUrl()}/gw/agenda?${q}`, { headers: auth(token) });
	if (!res.ok) throw await gatewayError(res);
	return await res.json();
};

export const getConnectors = async (token: string): Promise<ConnectorsResponse> => {
	const res = await fetch(`${gatewayUrl()}/gw/connectors`, { headers: auth(token) });
	if (!res.ok) throw await gatewayError(res);
	return await res.json();
};

/** Returns the provider consent URL; the caller sets window.location to it. */
export const authorizeConnector = async (token: string, provider: ConnectorProvider): Promise<string> => {
	const res = await fetch(`${gatewayUrl()}/gw/connectors/${provider}/authorize`, { headers: auth(token) });
	if (!res.ok) throw await gatewayError(res);
	return (await res.json()).url as string;
};

export const disconnectConnector = async (token: string, provider: ConnectorProvider): Promise<boolean> => {
	const res = await fetch(`${gatewayUrl()}/gw/connectors/${provider}`, {
		method: 'DELETE',
		headers: auth(token)
	});
	if (!res.ok) throw await gatewayError(res);
	return Boolean((await res.json()).disconnected);
};

// --- writes and pins --------------------------------------------------------
// Two-step in the UI (the page confirms first), idempotent at the source. The
// gateway's detail is a plain string; GatewayError carries it to the page.

const json = (token: string) => ({ ...auth(token), 'Content-Type': 'application/json' });

const send = async (token: string, method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) => {
	const res = await fetch(`${gatewayUrl()}${path}`, {
		method,
		headers: body === undefined ? auth(token) : json(token),
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	if (!res.ok) throw await gatewayError(res);
	return await res.json();
};

const itemPath = (kind: 'tasks' | 'events', source: AgendaSource, sourceId: string) =>
	`/gw/agenda/${kind}/${source}/${encodeURIComponent(sourceId)}`;

export const completeTask = async (token: string, source: AgendaSource, sourceId: string): Promise<void> => {
	await send(token, 'POST', `${itemPath('tasks', source, sourceId)}/complete`);
};

export const snoozeTask = async (token: string, source: AgendaSource, sourceId: string, until: string): Promise<void> => {
	await send(token, 'POST', `${itemPath('tasks', source, sourceId)}/snooze`, { until });
};

export const moveEvent = async (
	token: string, source: AgendaSource, sourceId: string, startAt: string, endAt: string
): Promise<void> => {
	await send(token, 'POST', `${itemPath('events', source, sourceId)}/move`, { startAt, endAt });
};

export const putPin = async (
	token: string,
	body: { source: AgendaSource; sourceId: string; clientId: string; verdict: 'match' | 'reject' }
): Promise<AgendaPin> => (await send(token, 'PUT', '/gw/agenda/pins', body)) as AgendaPin;

export const deletePins = async (token: string, source: AgendaSource, sourceId: string): Promise<number> =>
	Number((await send(token, 'DELETE', `/gw/agenda/pins/${source}/${encodeURIComponent(sourceId)}`)).deleted ?? 0);
