// Deep client sync: six sequential catalog reads, merged into one
// ClientDetail document, saved progressively. Spec §6.
// Types MIRROR shared-contracts/api-responses.ts (hand-sync convention).
import { XplanNotLoggedInError, XplanCancelledError } from './index';

export type ClientSectionName = 'contact' | 'financials' | 'insurance' | 'tasks' | 'notes' | 'super';

export interface ClientSection {
	status: 'ok' | 'error';
	syncedAt: string;
	data: unknown;
}

export interface ClientDetail {
	clientId: string;
	name: string;
	sections: Partial<Record<ClientSectionName, ClientSection>>;
}

export interface DeepSyncDeps {
	run: (opId: string, params: Record<string, string>) => Promise<unknown>;
	save: (detail: ClientDetail) => Promise<void>;
	onProgress?: (section: ClientSectionName, state: 'start' | 'ok' | 'error') => void;
}

export const SECTION_OPS = [
	['contact', 'client.contact'],
	['financials', 'client.financials'],
	['insurance', 'client.insurance'],
	['tasks', 'client.tasks'],
	['notes', 'client.notes'],
	['super', 'client.super']
] as const;

// One deep sync at a time — one Chrome, one agent (spec §7).
let active = false;
export const isDeepSyncActive = () => active;

const runSection = async (
	detail: ClientDetail,
	section: ClientSectionName,
	opId: string,
	deps: DeepSyncDeps
): Promise<void> => {
	deps.onProgress?.(section, 'start');
	try {
		const data = await deps.run(opId, { clientId: detail.clientId });
		detail.sections[section] = { status: 'ok', syncedAt: new Date().toISOString(), data };
		deps.onProgress?.(section, 'ok');
	} catch (e) {
		// NOT_LOGGED_IN and a user Stop both abort the whole sequence — a cancel
		// must not be recorded as a section "error".
		if (e instanceof XplanNotLoggedInError || e instanceof XplanCancelledError) throw e;
		detail.sections[section] = { status: 'error', syncedAt: new Date().toISOString(), data: null };
		deps.onProgress?.(section, 'error');
	}
	await deps.save(detail);
};

export const runClientDeepSync = async (
	clientId: string,
	name: string,
	deps: DeepSyncDeps,
	base?: ClientDetail,
	signal?: AbortSignal
): Promise<ClientDetail> => {
	if (active) throw new Error('A client sync is already running. Wait for it to finish.');
	active = true;
	try {
		const detail: ClientDetail = base ?? { clientId, name, sections: {} };
		for (const [section, opId] of SECTION_OPS) {
			if (signal?.aborted) return detail; // Stopped between sections — keep partial.
			try {
				await runSection(detail, section, opId, deps);
			} catch (e) {
				if (e instanceof XplanCancelledError) return detail; // Stopped mid-section.
				throw e; // NOT_LOGGED_IN (or other) aborts and propagates to the caller.
			}
		}
		return detail;
	} finally {
		active = false;
	}
};

export const resyncSection = async (
	detail: ClientDetail,
	section: ClientSectionName,
	deps: DeepSyncDeps,
	signal?: AbortSignal
): Promise<ClientDetail> => {
	if (active) throw new Error('A client sync is already running. Wait for it to finish.');
	active = true;
	try {
		const opId = SECTION_OPS.find(([s]) => s === section)?.[1];
		if (!opId) throw new Error(`Unknown section: ${section}`);
		if (signal?.aborted) return detail;
		try {
			await runSection(detail, section, opId, deps);
		} catch (e) {
			if (e instanceof XplanCancelledError) return detail; // Stopped — keep prior data.
			throw e;
		}
		return detail;
	} finally {
		active = false;
	}
};
