// Renders hermes prompts from catalog entries. The safety rails live HERE,
// once — no catalog entry can forget them.
import type { Params, XplanOperation } from './playbook';

/** Strip characters that could break out of the prompt template. */
export const safe = (s: string): string => s.replace(/["'`\r\n]/g, ' ').trim();

const sanitize = (params: Params): Params =>
	Object.fromEntries(Object.entries(params).map(([k, v]) => [k, safe(v)]));

export const buildPrompt = (op: XplanOperation, params: Params = {}): string => {
	const p = sanitize(params);
	const url = typeof op.url === 'function' ? op.url(p) : op.url;
	const lines = [
		'You are connected to a browser already logged in to XPLAN (IRESS financial',
		'planning software) for a financial planner.',
		'',
		'Do EXACTLY this and nothing more: call browser_navigate once to',
		url,
		...(op.navHints ?? []).map((h) => `Then: ${h}`),
		...(op.maxScrolls
			? [`You may scroll the page at most ${op.maxScrolls} time(s) to reveal the full table.`]
			: []),
		'',
		'Then read:',
		...op.extract.map((e) => `- ${e}`),
		'',
		'Output format — STRICT, no prose, no code fences:',
		op.outputSpec,
		'Output nothing else.',
		'',
		'If you are not logged in, output exactly: NOT_LOGGED_IN',
		'Do NOT use browser_cdp, execute_code, or browser_snapshot. Do not loop.'
	];
	return lines.join('\n');
};
