// The one thing a new developer cannot discover from the app unless the app
// says so: the host caretaker. Pure functions so the page stays untested UI.
import type { XplanStatus } from './index';

export const needsHelper = (s: Pick<XplanStatus, 'browserUp' | 'helper'>): boolean =>
	!s.browserUp && s.helper === 'not-installed';

const COMMANDS = {
	mac: { os: 'mac' as const, label: 'macOS', cmd: 'python3 scripts/xplan-chrome-agent.py --install' },
	win: { os: 'win' as const, label: 'Windows', cmd: 'py scripts\\xplan-chrome-agent.py --install' }
};

/** Both commands, the visitor's OS first. The UA is a hint, never a gate. */
export const installCommands = (userAgent: string) =>
	/Windows/i.test(userAgent) ? [COMMANDS.win, COMMANDS.mac] : [COMMANDS.mac, COMMANDS.win];
