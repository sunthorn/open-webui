import { describe, it, expect } from 'vitest';
import { buildPrompt, safe } from './prompt';
import type { XplanOperation } from './playbook';

const op: XplanOperation = {
	id: 'test.op',
	title: 'Test op',
	reconDoc: 'docs/xplan-playbook/01-dashboard.md',
	url: (p) => `https://sparkfg.xplan.iress.com.au/page?entity_id=${p.clientId}`,
	navHints: ['click the Contact tab in the left menu'],
	extract: ['the Preferred Name field', 'the Email table rows'],
	outputFormat: 'lines',
	outputSpec: 'one line per email: address|type',
	parse: (raw) => raw
};

describe('safe', () => {
	it('strips quote/backtick/newline injection characters', () => {
		// Each of " ' ` \r \n becomes a single space; ends trimmed.
		expect(safe(`a"b'c\`d\r\ne`)).toBe('a b c d  e');
		expect(safe('  padded  ')).toBe('padded');
	});
});

describe('buildPrompt', () => {
	const prompt = buildPrompt(op, { clientId: '782356' });
	it('includes the resolved url', () => {
		expect(prompt).toContain('https://sparkfg.xplan.iress.com.au/page?entity_id=782356');
	});
	it('injects navigate-once discipline', () => {
		expect(prompt).toContain('Do EXACTLY this and nothing more');
		expect(prompt).toContain('browser_navigate once');
	});
	it('injects forbidden tools + no-loop rails', () => {
		expect(prompt).toContain('browser_cdp');
		expect(prompt).toContain('execute_code');
		expect(prompt).toContain('browser_snapshot');
		expect(prompt).toContain('Do not loop');
	});
	it('injects the NOT_LOGGED_IN sentinel', () => {
		expect(prompt).toContain('NOT_LOGGED_IN');
	});
	it('includes navHints, extract list and outputSpec', () => {
		expect(prompt).toContain('click the Contact tab');
		expect(prompt).toContain('Preferred Name');
		expect(prompt).toContain('address|type');
	});
	it('sanitizes params before url interpolation', () => {
		const p = buildPrompt(op, { clientId: `1"2\n3` });
		expect(p).not.toContain('"2');
		expect(p).not.toMatch(/entity_id=1"/);
	});
});
