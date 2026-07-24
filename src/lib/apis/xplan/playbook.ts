// The XPLAN operations catalog — every agent action defined as data.
// Spec: docs/superpowers/specs/2026-07-25-xplan-integration-design.md §3.
export type Params = Record<string, string>;
export type OutputFormat = 'lines' | 'json' | 'text';

export interface XplanOperation {
	id: string; // 'client.contact'
	title: string;
	reconDoc: string; // docs/xplan-playbook/… note this entry was built from
	url: string | ((p: Params) => string); // deterministic navigation preferred
	navHints?: string[]; // extra steps only when the URL alone isn't enough
	extract: string[]; // plain-language read list, from recon
	outputFormat: OutputFormat;
	outputSpec: string; // exact output-format instruction
	parse: (raw: string) => unknown; // paired strict parser
	timeoutMs?: number; // default 120_000
	maxScrolls?: number; // default 0 = no scrolling
}
