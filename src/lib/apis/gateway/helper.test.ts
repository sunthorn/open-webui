import { describe, it, expect } from 'vitest';
import { needsHelper, installCommands } from './helper';

describe('needsHelper', () => {
	it('is true only when the browser is down AND the helper is not installed', () => {
		expect(needsHelper({ browserUp: false, helper: 'not-installed' })).toBe(true);
		expect(needsHelper({ browserUp: false, helper: 'running' })).toBe(false);
		expect(needsHelper({ browserUp: true, helper: 'not-installed' })).toBe(false);
		expect(needsHelper({ browserUp: false })).toBe(false); // older gateway: say nothing
	});
});

describe('installCommands', () => {
	it('puts the visitor OS first and always shows both', () => {
		const mac = installCommands('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)');
		expect(mac.map((c) => c.os)).toEqual(['mac', 'win']);
		const win = installCommands('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
		expect(win.map((c) => c.os)).toEqual(['win', 'mac']);
	});
	it('gives the exact commands from scripts/README.md', () => {
		const cmds = Object.fromEntries(installCommands('').map((c) => [c.os, c.cmd]));
		expect(cmds.mac).toBe('python3 scripts/xplan-chrome-agent.py --install');
		expect(cmds.win).toBe('py scripts\\xplan-chrome-agent.py --install');
	});
});
