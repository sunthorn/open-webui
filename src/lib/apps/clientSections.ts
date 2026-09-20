// The client detail page's rail: which sections exist, how they group, what
// colour each dot is, and which one to open first. Pure — no Svelte, no
// fetch — so the choices are testable and the components stay dumb.
//
// Groups and order mirror contact-layer/app/pages.py (the XPLAN menus the
// pages sit under) plus `tasks`, which is not a factfind page: the deep sync
// files the client's open tasks from the firm-wide to-do list as a 24th
// section. A section the store returns that is not listed here is appended
// to the last group rather than hidden, so a page added server-side still
// shows up.
import type { XplanClientSection } from '$lib/apis/gateway';

export type SectionGroup = {
	key: 'client' | 'financial' | 'insurance' | 'tasks';
	label: string;
	sections: string[];
};

export const SECTION_GROUPS: SectionGroup[] = [
	{
		key: 'client',
		label: 'Client',
		sections: [
			'key_details',
			'habits',
			'contact',
			'employment',
			'dependants',
			'identity',
			'domicile',
			'category',
			'notes',
			'client_report'
		]
	},
	{
		key: 'financial',
		label: 'Financial',
		sections: [
			'cashflow',
			'balancesheet',
			'net_value',
			'balance_sheet_custom',
			'budget',
			'annuities',
			'super',
			'estate',
			'centrelink'
		]
	},
	{
		key: 'insurance',
		label: 'Insurance',
		sections: ['insurance_owner', 'insurance_life', 'insurance_medical', 'insurance_general']
	},
	{ key: 'tasks', label: 'Tasks', sections: ['tasks'] }
];

// Mirrors the `label` column of pages.py.
export const SECTION_LABELS: Record<string, string> = {
	key_details: 'Key Details',
	habits: 'Personal Habits',
	contact: 'Contact & Demographics',
	employment: 'Employment Details',
	dependants: 'Dependants',
	identity: 'Identity Check',
	domicile: 'Domicile History',
	category: 'Category / Marketing',
	notes: 'File Notes',
	client_report: 'Merge / Client Report',
	cashflow: 'Income & Expenses',
	balancesheet: 'Assets & Liabilities',
	net_value: 'Net Position',
	balance_sheet_custom: 'Balance Sheet',
	budget: 'Budget',
	annuities: 'Annuities',
	super: 'Superannuation',
	estate: 'Estate Details',
	centrelink: 'Centrelink',
	insurance_owner: 'By Policy Owner',
	insurance_life: 'By Life Insured',
	insurance_medical: 'Medical',
	insurance_general: 'General',
	// Only open tasks are readable: XPLAN's list faults on option=done.
	tasks: 'Tasks (open)'
};

export const sectionLabel = (section: string) =>
	SECTION_LABELS[section] ?? section.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// 'changed' = XPLAN's page structure moved; 'error' = the read failed.
// Either way data-layer kept the last good rows, so what is on screen is
// STALE — the one thing a planner must know before acting on a number.
export const isStale = (s: XplanClientSection) => s.status === 'changed' || s.status === 'error';

/** One table the page scraper found, before any map decided where it belongs. */
export type CapturedPanel = { heading: string; headers: string[]; rows: Record<string, string>[] };

// XPLAN factfind pages carry inline <script> blocks whose text the scraper
// picks up as the nearest "heading" of the following table. Nothing a
// planner can read starts with a CDATA marker or a jQuery call.
const SCRIPT_HEADING = /^\s*(\/\/\s*<!\[CDATA\[|jQuery\s*\(|\$\s*\()/;

/**
 * The panels `deep_sync` captured but no verified map has promoted into
 * `rows` yet — what the planner sees while the map workflow is still to be
 * run for this tenant. Order is the stored (document) order; panels with
 * no rows and anything not panel-shaped are left out.
 */
export const unmappedPanels = (s: XplanClientSection): CapturedPanel[] =>
	Object.values(s.unmapped ?? {}).flatMap((v) => {
		const p = v as Partial<CapturedPanel> | null;
		if (!p || typeof p !== 'object' || !Array.isArray(p.rows) || !p.rows.length) return [];
		const heading = typeof p.heading === 'string' ? p.heading : '';
		if (SCRIPT_HEADING.test(heading)) return [];
		// The scraper keys a cell whose header is blank as `col<i>` — mirror
		// that so the row lookup still finds the value.
		const headers =
			Array.isArray(p.headers) && p.headers.length
				? p.headers.map((h, i) => h || `col${i}`)
				: Object.keys(p.rows[0] ?? {});
		return [{ heading, headers, rows: p.rows }];
	});

export type Dot = 'current' | 'empty' | 'stale' | 'error';

const DOT_RANK: Record<Dot, number> = { empty: 0, current: 1, stale: 2, error: 3 };

const dotOf = (s: XplanClientSection): Dot =>
	s.status === 'error'
		? 'error'
		: s.status === 'changed'
			? 'stale'
			: s.status === 'ok'
				? 'current'
				: 'empty';

/** One dot for a section that a couple may have read twice: the worst wins. */
export const sectionDot = (rows: XplanClientSection[]): Dot =>
	rows.reduce<Dot>(
		(worst, s) => (DOT_RANK[dotOf(s)] > DOT_RANK[worst] ? dotOf(s) : worst),
		'empty'
	);

export type RailEntry = {
	section: string;
	label: string;
	dot: Dot;
	rowCount: number;
	read: boolean;
};
export type RailGroup = { key: SectionGroup['key']; label: string; entries: RailEntry[] };

const entry = (section: string, rows: XplanClientSection[]): RailEntry => ({
	section,
	label: sectionLabel(section),
	dot: sectionDot(rows),
	rowCount: rows.reduce((n, s) => n + (s.rows?.length ?? 0), 0),
	// Whether the store returned at least one row for this section — i.e.
	// whether it was read at all, not whether it came back with data. Kept
	// separate from `dot`, which stays 'empty' for both cases (T3 relies on
	// that), so callers that need to tell "unread" from "read but empty"
	// apart can.
	read: rows.length > 0
});

export const groupSections = (sections: XplanClientSection[]): RailGroup[] => {
	const bySection = new Map<string, XplanClientSection[]>();
	for (const s of sections) bySection.set(s.section, [...(bySection.get(s.section) ?? []), s]);
	const known = new Set(SECTION_GROUPS.flatMap((g) => g.sections));
	const groups: RailGroup[] = SECTION_GROUPS.map((g) => ({
		key: g.key,
		label: g.label,
		entries: g.sections.map((name) => entry(name, bySection.get(name) ?? []))
	}));
	for (const name of bySection.keys()) {
		if (!known.has(name)) groups[groups.length - 1].entries.push(entry(name, bySection.get(name)!));
	}
	return groups;
};

/** Rail order, flattened — the order "first" means in below. */
const railOrder = (sections: XplanClientSection[]) =>
	groupSections(sections).flatMap((g) => g.entries);

/**
 * Which section to open: the hash if it names one; else the first stale
 * section (a planner must see those before acting); else the first with
 * rows; else the first that was read at all; null when nothing was.
 */
export const defaultSection = (sections: XplanClientSection[], hash = ''): string | null => {
	const wanted = hash.replace(/^#/, '');
	const read = new Set(sections.map((s) => s.section));
	if (wanted && read.has(wanted)) return wanted;
	const order = railOrder(sections).filter((e) => read.has(e.section));
	return (
		order.find((e) => e.dot === 'stale' || e.dot === 'error')?.section ??
		order.find((e) => e.rowCount > 0)?.section ??
		order[0]?.section ??
		null
	);
};
