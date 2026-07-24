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

// --- Migrated operations (Task 7) ------------------------------------------
// The 4 pre-catalog XPLAN reads, ported into data form. URLs/instructions are
// sourced from the recon playbook notes cited per-entry as `reconDoc`.

export interface XplanClient {
	name: string;
	id: string; // XPLAN entity id if extractable, else ''
}

export interface ClientPage {
	total: number; // total clients reported by XPLAN ("… of 1817"), 0 if unknown
	rows: XplanClient[];
}

export interface RawBriefingItem {
	title: string;
	client?: string;
	detail?: string;
	dueAt?: string; // ISO 'YYYY-MM-DD' or ''
	time?: string; // 'HH:MM' or ''
	done?: boolean;
}

const jsonOf = (raw: string): unknown => {
	try {
		return JSON.parse(raw);
	} catch {
		throw new Error('XPLAN returned an unexpected format. Try again.');
	}
};

// clients.search reads XPLAN's internal /resourceful/entity JSON resource —
// see docs/xplan-playbook/02-client-search.md. Rows look like
// {"entity_name": "...", "entity_id": 123456, "role": "client", "title_fields": [...]}.
export const parseClientList = (raw: string): XplanClient[] => {
	const parsed = jsonOf(raw);
	if (!Array.isArray(parsed)) return [];
	return parsed
		.filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
		.filter((c) => String(c.entity_name ?? '').trim().length > 0)
		.map((c) => ({ name: String(c.entity_name).trim(), id: String(c.entity_id ?? '') }));
};

export const parseBookPage = (raw: string): ClientPage => {
	let total = 0;
	const rows: XplanClient[] = [];
	for (const line of raw.split('\n').map((l) => l.trim()).filter(Boolean)) {
		const m = line.match(/^TOTAL\s*=\s*(\d+)/i);
		if (m) {
			total = parseInt(m[1], 10) || 0;
			continue;
		}
		const [namePart, idPart = ''] = line.split('|');
		const name = namePart.trim();
		if (name && !/^total\s*=/i.test(name)) rows.push({ name, id: idPart.trim() });
	}
	return { total, rows };
};

export const parseBriefingItems = (raw: string): RawBriefingItem[] => {
	const parsed = jsonOf(raw);
	if (!Array.isArray(parsed)) return [];
	return parsed
		.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
		.map((x) => ({
			title: String(x.title ?? ''),
			client: x.client ? String(x.client) : undefined,
			detail: x.detail ? String(x.detail) : undefined,
			dueAt: x.dueAt ? String(x.dueAt) : undefined,
			time: x.time ? String(x.time) : undefined,
			done: !!x.done
		}))
		.filter((x) => x.title.trim().length > 0);
};

const BASE = 'https://sparkfg.xplan.iress.com.au';

export const PLAYBOOK: Record<string, XplanOperation> = {
	'overview.summary': {
		id: 'overview.summary',
		title: "Summarize the planner's dashboard",
		reconDoc: 'docs/xplan-playbook/01-dashboard.md',
		url: `${BASE}/dashboard/mainhtml`,
		extract: [
			'the panels visible on the Main dashboard tab — Diary (appointments),',
			'Recent Clients, Outstanding Tasks, Client Birthday — only the panels',
			'actually present for this planner'
		],
		outputFormat: 'text',
		outputSpec: 'a SHORT plain-text summary: max 6 bullet lines, each starting with "- "',
		parse: (raw) => raw,
		timeoutMs: 90_000
	},
	'clients.search': {
		id: 'clients.search',
		title: 'Search clients by name',
		reconDoc: 'docs/xplan-playbook/02-client-search.md',
		// encodeURIComponent is additive on top of buildPrompt's safe()
		// sanitization (which already strips quote/backtick/newline chars from
		// params before url() runs) — it stops URL metacharacters (&, #, =, %,
		// +, space) in the query from injecting extra querystring params or
		// truncating the URL.
		url: (p) =>
			`${BASE}/resourceful/entity?quicksearch=${encodeURIComponent(p.query)}&title_fields=true&roles.0=client`,
		extract: ['the raw JSON array rendered as the page body'],
		outputFormat: 'json',
		outputSpec: "output the page's JSON array VERBATIM, exactly as rendered, and nothing else",
		parse: parseClientList
	},
	'clients.bookPage': {
		id: 'clients.bookPage',
		title: 'Read one page of the client book',
		reconDoc: 'docs/xplan-playbook/02-client-search.md',
		url: `${BASE}/factfind/search/result?role=client`,
		navHints: [
			'if {page} is greater than 1, use the results pager at the bottom of the table to go to results page {page}'
		],
		extract: [
			'EVERY client row in the results table on the CURRENT page — do not stop early',
			'if the results table shows zero client rows, output TOTAL=0 and nothing else'
		],
		outputFormat: 'lines',
		outputSpec:
			'FIRST line: TOTAL=<total client count shown, e.g. from "1 to 100 of 1817">, else TOTAL=0. THEN one line per client: name|id (id from the row link href, or empty)',
		parse: parseBookPage
	},
	'briefing.gather': {
		id: 'briefing.gather',
		title: "Read today's tasks / diary / reviews",
		reconDoc: 'docs/xplan-playbook/01-dashboard.md',
		url: `${BASE}/dashboard/mainhtml`,
		extract: ["the planner's TASKS, DIARY / APPOINTMENTS and REVIEWS visible on the page"],
		outputFormat: 'json',
		outputSpec:
			'a JSON array of items, each {"title":"...","client":"name or empty","dueAt":"YYYY-MM-DD or empty","time":"HH:MM or empty","done":false,"detail":""}. Dates on the page are DD/MM/YYYY — convert to YYYY-MM-DD in dueAt. If none visible: []',
		parse: parseBriefingItems
	}
};
