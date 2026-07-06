// Leads — a new prospect created at Stage 1 (New Enquiry). Persisted in the
// data-layer as one document at key `leads` (an array), so the Clients hub can
// show real "New leads" and the enquiry checklist survives reloads. A lead is
// the pre-client record; it carries forward as the prospect moves through the
// process.
import { getOutput, putOutput } from '$lib/apis/gateway';

// The Stage 1 checklist — shared so New Enquiry and progress counts agree.
export const ENQUIRY_STEPS = [
	{ id: 'welcome', title: 'Welcome Pack', detail: 'Send the welcome pack to the prospect.' },
	{ id: 'fsg', title: 'FSG', detail: 'Provide the Financial Services Guide.' },
	{ id: 'factfind', title: 'Fact Find', detail: 'Capture initial details and needs.' },
	{ id: 'book', title: 'Book Discovery Meeting', detail: 'Schedule the discovery meeting in the diary.' }
] as const;

// The Stage 2 checklist.
export const DISCOVERY_STEPS = [
	{ id: 'goals', title: 'Clarify Goals', detail: 'What does the client want to achieve, and by when.' },
	{ id: 'collect', title: 'Collect Information', detail: 'Assets, liabilities, income, insurance, super.' },
	{ id: 'scope', title: 'Define Scope', detail: 'Agree what the advice will and won’t cover.' },
	{ id: 'risk', title: 'Risk Profiling', detail: 'Assess risk tolerance and capacity.' }
] as const;

export interface Lead {
	id: string;
	name: string;
	createdAt: string; // ISO
	stage: 'enquiry' | 'discovery' | 'data-entry';
	enquiry: Record<string, boolean>; // step id → done
	discovery?: Record<string, boolean>;
}

/** Count completed steps in a checklist map. */
export const countDone = (
	steps: readonly { id: string }[],
	map: Record<string, boolean> | undefined
): number => steps.filter((s) => map?.[s.id]).length;

const KEY = 'leads';

export const loadLeads = async (token: string): Promise<Lead[]> => {
	const doc = await getOutput<{ leads: Lead[] }>(token, KEY);
	return doc?.leads ?? [];
};

export const saveLeads = async (token: string, leads: Lead[]): Promise<void> => {
	await putOutput(token, KEY, 'leads', { leads });
};

/** Insert or replace a lead by id, then persist. Returns the full list. */
export const upsertLead = async (token: string, lead: Lead): Promise<Lead[]> => {
	const list = await loadLeads(token);
	const next = [lead, ...list.filter((l) => l.id !== lead.id)];
	await saveLeads(token, next);
	return next;
};

export const enquiryProgress = (lead: Lead): number =>
	ENQUIRY_STEPS.filter((s) => lead.enquiry?.[s.id]).length;
