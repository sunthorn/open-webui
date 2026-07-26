// Renders hermes prompts from catalog entries. The safety rails live HERE,
// once — no catalog entry can forget them.
import type { Params, XplanOperation } from './playbook';

/** Strip characters that could break out of the prompt template. */
export const safe = (s: string): string => s.replace(/["'`\r\n]/g, ' ').trim();

const sanitize = (params: Params): Params =>
	Object.fromEntries(Object.entries(params).map(([k, v]) => [k, safe(v)]));

/** Replace `{key}` tokens with `params[key]`; tokens with no matching param are left as-is. */
const interpolate = (s: string, p: Params): string =>
	s.replace(/\{(\w+)\}/g, (m, key) => (key in p ? p[key] : m));

export const buildPrompt = (op: XplanOperation, params: Params = {}): string => {
	const p = sanitize(params);
	const url = typeof op.url === 'function' ? op.url(p) : op.url;
	const opening = url
		? ['Do EXACTLY this and nothing more: call browser_navigate once to', url]
		: [
				'Do EXACTLY this and nothing more. Do NOT navigate and do NOT re-run any',
				'search — the browser is already on the correct results page.'
			];
	const lines = [
		'You are connected to a browser already logged in to XPLAN (IRESS financial',
		'planning software) for a financial planner.',
		'',
		...opening,
		...(op.navHints ?? []).map((h) => `Then: ${interpolate(h, p)}`),
		...(op.maxScrolls
			? [`You may scroll the page at most ${op.maxScrolls} time(s) to reveal the full table.`]
			: []),
		'',
		'Then read:',
		...op.extract.map((e) => `- ${interpolate(e, p)}`),
		'',
		'Output format — STRICT, no prose, no code fences:',
		interpolate(op.outputSpec, p),
		'Output nothing else.',
		'',
		'If you are not logged in, output exactly: NOT_LOGGED_IN',
		`Do NOT use browser_cdp, execute_code, or browser_snapshot. ${
			op.paging ? 'Do not loop beyond the paging described above.' : 'Do not loop.'
		}`
	];
	return lines.join('\n');
};
