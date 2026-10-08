import { describe, it, expect } from 'vitest';
import { clientHeader } from './clientHeader';

describe('clientHeader', () => {
	it('names the active client on the request', () => {
		expect(clientHeader('899317')).toEqual({ 'X-Axi-Client': '899317' });
	});
	it('sends nothing when no client is active', () => {
		expect(clientHeader(null)).toEqual({});
		expect(clientHeader('   ')).toEqual({});
	});
	it('sends nothing for a value hermes would discard', () => {
		expect(clientHeader('../x')).toEqual({});
		expect(clientHeader('a'.repeat(65))).toEqual({});
		expect(clientHeader('a'.repeat(64))).toEqual({ 'X-Axi-Client': 'a'.repeat(64) });
	});
});
