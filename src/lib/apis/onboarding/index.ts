import { WEBUI_BASE_URL } from '$lib/constants';
import { uploadFile } from '$lib/apis/files';

// xplan-agent · New Client Onboarding (Phase A — extract + propose, no write).
//
// Flow: upload each document to Open WebUI (which extracts its text via the
// configured loaders) → send the combined text to a plain LLM with the XPLAN
// field taxonomy → get back a structured OnboardingProposal for the planner to
// review. No browser, no XPLAN access — so this runs with the guardrail LOCKED.
//
// These types MIRROR shared-contracts/api-responses.ts (OnboardingProposal et
// al.). The open-webui Docker build context is ./open-webui only, so it cannot
// import the shared file at build time — keep in sync by hand (infra debt).

export type ProposalStatus = 'proposed' | 'approved' | 'edited' | 'rejected';

export interface ProposalItem {
	id: string;
	section: string;
	field: string;
	value: string;
	xplanResource: string;
	xplanField?: string;
	sourceDoc: string;
	confidence?: number;
	status: ProposalStatus;
}

export interface OnboardingProposal {
	client: { mode: 'new' | 'existing'; id?: string; name: string };
	compiledAt: string;
	sourceDocs: string[];
	items: ProposalItem[];
	notes?: string;
}

export interface ExtractedDoc {
	filename: string;
	text: string;
}

// Model used to structure the proposal. A plain text model (no browser tools),
// so onboarding never needs the XPLAN guardrail unlocked. Cheap + capable.
const PROPOSE_MODEL = 'gemini-3-flash-preview';

/**
 * Upload one document to Open WebUI and return its extracted text.
 * `process=true` runs OWUI's loaders (Tika/docx/xlsx/OCR) synchronously; the
 * extracted text lands in `res.data.content`.
 * @throws on upload/extract failure
 */
export const extractDocument = async (token: string, file: File): Promise<ExtractedDoc> => {
	const res = await uploadFile(token, file, null, true, false);
	const text = (res?.data?.content ?? '').trim();
	if (!text) {
		throw new Error(`No text could be extracted from "${file.name}". If it's a scanned image, OCR may not be configured.`);
	}
	return { filename: file.name, text };
};

// The XPLAN field taxonomy (docs/xplan-field-mapping.md), compacted for the
// prompt. hermes/the model maps extracted facts onto these resources.
const FIELD_TAXONOMY = [
	'Personal → Client: title, firstName, preferredName, lastName, dob (ISO), gender, maritalStatus, smoker, tfn(SENSITIVE)',
	'Contact → Contact: mobile, homePhone, email | Address: residential, postal',
	'Employment → Employment: employer, occupation, status | Income → Income: salary(gross p.a.), rental, other',
	'Expenses → Expense: living(annual)',
	'Assets → Asset: property, cash, investments, vehicle (each with value/ownership)',
	'Liabilities → Liability: mortgage, personalLoan, creditCard (balance/rate/repayment)',
	'Superannuation → Superannuation: fundName, memberNumber, balance, investmentOption',
	'Insurance → Insurance: type(Life/TPD/IP/Trauma), sumInsured, premium, provider',
	'Risk → RiskProfile: category | Dependants → Dependant: name+DOB+relationship | Goals → Goal: text'
].join('\n');

const buildPrompt = (clientName: string, docs: ExtractedDoc[]): string =>
	[
		'You are a data-entry assistant for an Australian financial planner. You are',
		`preparing to onboard a new client named "${clientName}" into XPLAN (IRESS).`,
		'',
		'From the DOCUMENTS below, extract every fact that maps onto this XPLAN field',
		'taxonomy (section → resource: fields):',
		FIELD_TAXONOMY,
		'',
		'RULES:',
		'- Only include a field if the documents actually support a value. No value → omit it.',
		'- Normalise: dates → ISO YYYY-MM-DD; money → plain number (no $ or commas); annualise income/expenses.',
		'- Flag sensitive fields (tfn, ID numbers) with confidence ≤ 0.4 and a note; still include them.',
		'- One item per fact. Multiple assets/insurances/dependants → multiple items with distinct ids.',
		'- Attribute each item to the sourceDoc filename it came from ("" if inferred across docs).',
		'- confidence is 0..1; ambiguous/derived values ≤ 0.6.',
		'',
		'Respond with STRICT JSON ONLY (no prose, no code fences), matching:',
		'{"items":[{"id":"section:field","section":"Personal","field":"Date of birth",',
		'"value":"1980-04-12","xplanResource":"Client","xplanField":"dob",',
		'"sourceDoc":"factfind.pdf","confidence":0.9}], "notes":"any caveats"}',
		'',
		'DOCUMENTS:',
		...docs.map((d) => `\n===== ${d.filename} =====\n${d.text}`)
	].join('\n');

const stripFences = (s: string): string =>
	s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

/**
 * Ask the model to turn extracted document text into a structured proposal.
 * Uses OWUI's light /openai/chat/completions proxy (no browser tools involved).
 * @throws on transport error or unparseable model output
 */
export const proposeMapping = async (
	token: string,
	clientName: string,
	mode: 'new' | 'existing',
	docs: ExtractedDoc[],
	timeoutMs = 120_000
): Promise<OnboardingProposal> => {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(`${WEBUI_BASE_URL}/openai/chat/completions`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: PROPOSE_MODEL,
				messages: [{ role: 'user', content: buildPrompt(clientName, docs) }],
				stream: false,
				temperature: 0
			}),
			signal: controller.signal
		});
		if (!res.ok) {
			const detail = await res.json().catch(() => ({}));
			throw new Error(detail?.detail ?? detail?.error ?? `HTTP ${res.status}`);
		}
		const data = await res.json();
		const raw = (data?.choices?.[0]?.message?.content ?? '').trim();
		let parsed: { items?: any[]; notes?: string };
		try {
			parsed = JSON.parse(stripFences(raw));
		} catch {
			throw new Error('The model did not return valid JSON. Try again, or reduce the number of documents.');
		}
		const items: ProposalItem[] = (parsed.items ?? []).map((it, i) => ({
			id: String(it.id ?? `item:${i}`),
			section: String(it.section ?? 'Other'),
			field: String(it.field ?? ''),
			value: String(it.value ?? ''),
			xplanResource: String(it.xplanResource ?? ''),
			xplanField: it.xplanField ? String(it.xplanField) : undefined,
			sourceDoc: String(it.sourceDoc ?? ''),
			confidence: typeof it.confidence === 'number' ? it.confidence : undefined,
			status: 'proposed'
		}));
		return {
			client: { mode, name: clientName },
			compiledAt: new Date().toISOString(),
			sourceDocs: docs.map((d) => d.filename),
			items,
			notes: parsed.notes ? String(parsed.notes) : undefined
		};
	} catch (e: any) {
		if (e?.name === 'AbortError') {
			throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s while building the proposal.`);
		}
		throw e;
	} finally {
		clearTimeout(timer);
	}
};
