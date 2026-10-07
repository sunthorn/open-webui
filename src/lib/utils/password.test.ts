import { describe, it, expect, vi, afterEach } from 'vitest';
import { webcrypto } from 'node:crypto';
import { generatePassword, PASSWORD_ALPHABET } from './password';

// Node 18 (this repo's floor) has no global Web Crypto; browsers always do.
if (!globalThis.crypto) {
	Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('generatePassword', () => {
	it('is 12 characters long', () => {
		for (let i = 0; i < 200; i++) expect(generatePassword()).toHaveLength(12);
	});

	it('uses only the look-alike-free alphabet', () => {
		for (const ch of '0Oo1lI') expect(PASSWORD_ALPHABET).not.toContain(ch);
		for (let i = 0; i < 500; i++) {
			for (const ch of generatePassword()) expect(PASSWORD_ALPHABET).toContain(ch);
		}
	});

	it('always contains a lowercase, an uppercase and a digit', () => {
		for (let i = 0; i < 1000; i++) {
			const pw = generatePassword();
			expect(pw).toMatch(/[a-z]/);
			expect(pw).toMatch(/[A-Z]/);
			expect(pw).toMatch(/[0-9]/);
		}
	});

	it('draws randomness from crypto.getRandomValues, never Math.random', () => {
		const cryptoSpy = vi.spyOn(globalThis.crypto, 'getRandomValues');
		const mathSpy = vi.spyOn(Math, 'random');
		generatePassword();
		expect(cryptoSpy).toHaveBeenCalled();
		expect(mathSpy).not.toHaveBeenCalled();
	});

	it('does not repeat itself', () => {
		const seen = new Set(Array.from({ length: 200 }, () => generatePassword()));
		expect(seen.size).toBe(200);
	});
});
