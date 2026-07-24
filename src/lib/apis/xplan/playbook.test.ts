import { describe, it, expect } from 'vitest';
import { PLAYBOOK, parseClientList, parseBookPage, parseBriefingItems } from './playbook';

// clients.search now reads XPLAN's internal /resourceful/entity JSON resource
// (recon: docs/xplan-playbook/02-client-search.md) — rows look like
// {"entity_name": "...", "entity_id": 123456, "role": "client", "title_fields": [...]}.
// Fixtures below use fabricated names/ids only — never real client data.
describe('parseClientList (clients.search)', () => {
	it('parses and coerces a valid array', () => {
		const raw = JSON.stringify([
			{ entity_name: 'Testperson, Alex', entity_id: 111111, role: 'client', title_fields: ['111111'] },
			{ entity_name: 'Sample, Bo', entity_id: 222222, role: 'client', title_fields: ['222222'] }
		]);
		expect(parseClientList(raw)).toEqual([
			{ name: 'Testperson, Alex', id: '111111' },
			{ name: 'Sample, Bo', id: '222222' }
		]);
	});
	it('drops non-objects and unnamed rows', () => {
		const raw = JSON.stringify([
			null,
			{ entity_id: 333333, role: 'client' },
			{ entity_name: 'Ok, One', entity_id: 444444, role: 'client', title_fields: ['444444'] }
		]);
		expect(parseClientList(raw)).toEqual([{ name: 'Ok, One', id: '444444' }]);
	});
	it('handles an empty result array', () => {
		expect(parseClientList('[]')).toEqual([]);
	});
	it('throws on non-JSON', () => {
		expect(() => parseClientList('the search returned some clients')).toThrow(/unexpected format/i);
	});
});

describe('parseBookPage (clients.bookPage)', () => {
	it('reads TOTAL= and name|id lines', () => {
		const raw = 'TOTAL=1817\nTestperson, Alex|111111\nSample, Bo|';
		expect(parseBookPage(raw)).toEqual({
			total: 1817,
			rows: [
				{ name: 'Testperson, Alex', id: '111111' },
				{ name: 'Sample, Bo', id: '' }
			]
		});
	});
	it('tolerates a missing TOTAL line', () => {
		expect(parseBookPage('Only, Row|9').total).toBe(0);
	});
	it('reads TOTAL=0 as an empty page', () => {
		expect(parseBookPage('TOTAL=0')).toEqual({ total: 0, rows: [] });
	});
});

describe('parseBriefingItems (briefing.gather)', () => {
	it('coerces items and drops untitled ones', () => {
		const raw = JSON.stringify([
			{ title: 'Review meeting', client: 'Testperson, Alex', dueAt: '2026-07-25', time: '10:00', done: false, detail: '' },
			{ title: '' },
			null
		]);
		const out = parseBriefingItems(raw);
		expect(out).toHaveLength(1);
		expect(out[0].title).toBe('Review meeting');
	});
	it('throws on non-JSON', () => {
		expect(() => parseBriefingItems('no tasks visible')).toThrow(/unexpected format/i);
	});
});

describe('PLAYBOOK migrated entries', () => {
	it('has the four migrated operations', () => {
		for (const id of ['overview.summary', 'clients.search', 'clients.bookPage', 'briefing.gather']) {
			expect(PLAYBOOK[id], id).toBeDefined();
			expect(PLAYBOOK[id].id).toBe(id);
			expect(PLAYBOOK[id].reconDoc).toMatch(/^docs\/xplan-playbook\//);
		}
	});

	it('clients.search builds a deterministic quicksearch URL with no navHints', () => {
		const op = PLAYBOOK['clients.search'];
		expect(typeof op.url).toBe('function');
		const url = (op.url as (p: Record<string, string>) => string)({ query: 'berry' });
		expect(url).toContain('/resourceful/entity?quicksearch=berry');
		expect(url).toContain('roles.0=client');
		expect(op.navHints ?? []).toHaveLength(0);
		expect(op.outputFormat).toBe('json');
	});

	it('clients.search URL-encodes a hostile query so it cannot inject extra querystring params', () => {
		const op = PLAYBOOK['clients.search'];
		const url = (op.url as (p: Record<string, string>) => string)({
			query: 'smith&roles.0=user#x'
		});
		expect(url).toContain('quicksearch=smith%26roles.0%3Duser%23x');
		// The injected "roles.0=user" must stay encoded — only the legitimate
		// trailing "&roles.0=client" param should appear as a real querystring key.
		expect(url.match(/(?:^|&)roles\.0=[^&]*/g)).toEqual(['&roles.0=client']);
	});

	it('clients.bookPage tells the agent to output TOTAL=0 when the table is empty', () => {
		const op = PLAYBOOK['clients.bookPage'];
		expect(op.extract.join(' ')).toMatch(/TOTAL=0/);
	});

	it('briefing.gather outputSpec documents the DD/MM/YYYY -> YYYY-MM-DD conversion', () => {
		const op = PLAYBOOK['briefing.gather'];
		expect(op.outputSpec).toMatch(/DD\/MM\/YYYY/);
		expect(op.outputSpec).toMatch(/YYYY-MM-DD/);
	});
});
