import { describe, it, expect } from 'vitest';
import {
	PLAYBOOK,
	parseClientList,
	parseBookPage,
	parseBriefingItems,
	parseClientContact,
	parsePipeTable,
	parseClientTasks,
	parseBookSweep,
	type BookSweepResult
} from './playbook';

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

describe('parseBookSweep', () => {
	it('parses total, reachedEnd and rows (name + id)', () => {
		const raw = JSON.stringify({ total: 757, reachedEnd: false, rows: [{ name: 'Butler, Lucia', id: 715828 }, { name: 'Ng, Sam', id: '720240' }] });
		const r = parseBookSweep(raw);
		expect(r.total).toBe(757);
		expect(r.reachedEnd).toBe(false);
		expect(r.rows).toEqual([{ name: 'Butler, Lucia', id: '715828' }, { name: 'Ng, Sam', id: '720240' }]);
	});
	it('coerces missing/blank total to 0 and defaults reachedEnd false', () => {
		const r = parseBookSweep(JSON.stringify({ rows: [] }));
		expect(r.total).toBe(0);
		expect(r.reachedEnd).toBe(false);
		expect(r.rows).toEqual([]);
	});
	it('drops rows with a blank name, keeps blank id as empty string', () => {
		const r = parseBookSweep(JSON.stringify({ total: 2, reachedEnd: true, rows: [{ name: '', id: 1 }, { name: 'A, B', id: null }] }));
		expect(r.rows).toEqual([{ name: 'A, B', id: '' }]);
	});
	it('throws the standard format error on non-JSON', () => {
		expect(() => parseBookSweep('not json')).toThrow(/unexpected format/i);
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

// client.* deep-sync operations (Task 9) — recon: docs/xplan-playbook/03-07.
// Fixtures below use fabricated names/ids only — never real client data.
describe('parseClientContact (client.contact)', () => {
	it('coerces a contact object and keeps only string fields', () => {
		const raw = JSON.stringify({
			name: 'Testperson, Alex',
			preferredName: 'Alex',
			dob: '1980-01-02',
			address: '1 Example St, Testville',
			phones: ['0400 000 000'],
			emails: ['alex@example.invalid'],
			partner: 'Testperson, Sam'
		});
		const out = parseClientContact(raw);
		expect(out.name).toBe('Testperson, Alex');
		expect(out.emails).toEqual(['alex@example.invalid']);
	});
	it('coerces partner contact fields when present (couples)', () => {
		const raw = JSON.stringify({
			name: 'Testperson, Alex',
			phones: [],
			emails: [],
			partner: 'Testperson, Sam',
			partnerPhones: ['0400 111 111'],
			partnerEmails: ['sam@example.invalid'],
			partnerAddress: '1 Example St, Testville'
		});
		const out = parseClientContact(raw);
		expect(out.partnerPhones).toEqual(['0400 111 111']);
		expect(out.partnerEmails).toEqual(['sam@example.invalid']);
		expect(out.partnerAddress).toBe('1 Example St, Testville');
	});
	it('throws on non-JSON', () => {
		expect(() => parseClientContact('cannot find the page')).toThrow(/unexpected format/i);
	});
});

describe('parsePipeTable (financials / insurance / notes)', () => {
	it('splits rows into trimmed cells', () => {
		const raw = 'Super Fund A|Balanced|123456.78\nInsurer B|Life|500000';
		expect(parsePipeTable(raw)).toEqual([
			['Super Fund A', 'Balanced', '123456.78'],
			['Insurer B', 'Life', '500000']
		]);
	});
	it('drops empty lines and a NONE sentinel', () => {
		expect(parsePipeTable('NONE')).toEqual([]);
		expect(parsePipeTable('\n\n')).toEqual([]);
	});
});

describe('parseClientTasks (client.tasks)', () => {
	it('reuses briefing-item coercion', () => {
		const raw = JSON.stringify([{ title: 'Annual review', dueAt: '2026-08-01' }]);
		expect(parseClientTasks(raw)).toHaveLength(1);
	});
});

describe('PLAYBOOK client.* entries', () => {
	it('exist, are entity-id parameterized, and cite recon docs', () => {
		for (const id of [
			'client.contact',
			'client.financials',
			'client.insurance',
			'client.tasks',
			'client.notes',
			'client.super'
		]) {
			const op = PLAYBOOK[id];
			expect(op, id).toBeDefined();
			expect(typeof op.url).toBe('function');
			expect((op.url as (p: Record<string, string>) => string)({ clientId: '111111' })).toContain(
				'111111'
			);
			expect(op.reconDoc).toMatch(/^docs\/xplan-playbook\/0[3-7]/);
		}
	});

	it('client.contact reads the client_contact factfind page (recon 03)', () => {
		const op = PLAYBOOK['client.contact'];
		const url = (op.url as (p: Record<string, string>) => string)({ clientId: '999999' });
		expect(url).toBe(
			'https://sparkfg.xplan.iress.com.au/factfind/view/999999?role=client&page=client_contact'
		);
		expect(op.outputFormat).toBe('json');
	});

	it('client.financials reads the balancesheet factfind page (recon 04)', () => {
		const op = PLAYBOOK['client.financials'];
		const url = (op.url as (p: Record<string, string>) => string)({ clientId: '999999' });
		expect(url).toBe(
			'https://sparkfg.xplan.iress.com.au/factfind/view/999999?role=client&page=balancesheet'
		);
		expect(op.outputFormat).toBe('lines');
		expect(op.outputSpec).toMatch(/NONE/);
	});

	it('client.insurance reads a tenant-specific custom page and flags it as such (recon 05)', () => {
		const op = PLAYBOOK['client.insurance'];
		const url = (op.url as (p: Record<string, string>) => string)({ clientId: '999999' });
		expect(url).toBe(
			'https://sparkfg.xplan.iress.com.au/factfind/view/999999?role=client&page=custom_page_185'
		);
		expect(op.outputFormat).toBe('lines');
		expect(op.outputSpec).toMatch(/NONE/);
		expect(op.extract.join(' ')).toMatch(/tenant|practice|custom/i);
	});

	it('client.tasks reads the cloud_app kanban SPA with a longer timeout (recon 06)', () => {
		const op = PLAYBOOK['client.tasks'];
		const url = (op.url as (p: Record<string, string>) => string)({ clientId: '999999' });
		expect(url).toBe('https://sparkfg.xplan.iress.com.au/cloud_app/tasks/999999/kanban');
		expect(op.outputFormat).toBe('json');
		expect(op.timeoutMs).toBe(120_000);
		expect((op.navHints ?? []).join(' ')).toMatch(/client-side|SPA/i);
	});

	it('client.notes reads the note factfind page and snippets untrusted note bodies (recon 07)', () => {
		const op = PLAYBOOK['client.notes'];
		const url = (op.url as (p: Record<string, string>) => string)({ clientId: '999999' });
		expect(url).toBe('https://sparkfg.xplan.iress.com.au/factfind/view/999999?role=client&page=note');
		expect(op.outputFormat).toBe('lines');
		expect(op.outputSpec).toMatch(/NONE/);
		expect(op.outputSpec).toMatch(/subject/i);
		expect((op.extract.join(' ') + op.outputSpec).toLowerCase()).toMatch(/untrusted/);
	});

	it('client.notes outputSpec tells the agent to replace pipe characters in the snippet', () => {
		const op = PLAYBOOK['client.notes'];
		expect(op.outputSpec).toMatch(/replace any "\|"/i);
	});

	it('client.super reads the super factfind page (recon 04)', () => {
		const op = PLAYBOOK['client.super'];
		const url = (op.url as (p: Record<string, string>) => string)({ clientId: '999999' });
		expect(url).toBe('https://sparkfg.xplan.iress.com.au/factfind/view/999999?role=client&page=super');
		expect(op.outputFormat).toBe('lines');
		expect(op.outputSpec).toMatch(/NONE/);
	});
});
