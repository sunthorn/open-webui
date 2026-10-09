// open-webui/src/lib/apis/finny/index.ts
// finny's documents, reached from the shell.
//
// Same origin, through the gateway: Caddy proxies /api/finny/* to
// finny-backend and strips the prefix; finny mounts everything under /api,
// so the browser path is /api/finny/api/… — exactly the VITE_API_BASE
// finny's own SPA is built with (docker-compose.yml). The Docker build
// context is ./open-webui, so the DTO shapes below are copied from
// finny/frontend/src/features/documents/documents.api.ts and finny's
// documents.service.ts extractedText, not imported — they must stay in sync.
//
// Auth is finny's own `finny_session` cookie (Path=/). It exists once the
// planner has opened finny's frame; if it does not, one POST to
// /auth/axi-session mints it — the gateway's forward_auth adds the signed
// X-Axi-* identity to that request from the OWUI session, so the shell
// never handles a finny credential itself. Every call sends the OWUI
// Bearer as well, which is what forward_auth checks.
export const FINNY_API = '/api/finny/api';

export class FinnyError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = 'FinnyError';
		this.status = status;
	}
}

export type IngestStatus = 'NONE' | 'PENDING' | 'EXTRACTING' | 'CHUNKING' | 'EMBEDDING' | 'INDEXED' | 'FAILED';

export interface FinnyDocument {
	id: string;
	title: string;
	status: string; // 'ACTIVE' | 'ARCHIVED'
	clientId: string;
	createdAt: string;
	updatedAt: string;
	currentVersion: { fileName: string; contentType: string; sizeBytes: number; createdAt: string } | null;
}

export interface DocumentText {
	documentId: string;
	versionId: string;
	versionNumber: number;
	status: IngestStatus;
	errorMessage: string | null;
	text: string | null;
}

const finnyError = async (res: Response, fallback: string): Promise<FinnyError> => {
	const body: any = await res.json().catch(() => ({}));
	const text = typeof body?.message === 'string' ? body.message : typeof body?.detail === 'string' ? body.detail : '';
	return new FinnyError(text.trim() || `${fallback} (${res.status})`, res.status);
};

/** Mint finny's session cookie from the gateway identity. Idempotent. */
export const ensureFinnySession = async (token: string): Promise<void> => {
	const res = await fetch(`${FINNY_API}/auth/axi-session`, {
		method: 'POST',
		credentials: 'include',
		headers: { Authorization: `Bearer ${token}` }
	});
	if (!res.ok) throw await finnyError(res, 'Could not open a finny session');
};

const finnyFetch = async (token: string, path: string, init: RequestInit = {}, retry = true): Promise<Response> => {
	const res = await fetch(`${FINNY_API}${path}`, {
		credentials: 'include',
		...init,
		headers: { Authorization: `Bearer ${token}`, ...((init.headers as Record<string, string>) ?? {}) }
	});
	if (res.status === 401 && retry) {
		await ensureFinnySession(token);
		return finnyFetch(token, path, init, false);
	}
	return res;
};

export const listClientDocuments = async (token: string, clientId: string): Promise<FinnyDocument[]> => {
	const res = await finnyFetch(token, `/clients/${encodeURIComponent(clientId)}/documents?pageSize=100`);
	if (!res.ok) throw await finnyError(res, 'Could not list documents');
	const body = await res.json();
	return (body?.items ?? []) as FinnyDocument[];
};

/** Upload one file as a new document of this client. finny validates the
 *  type (PDF, DOC/DOCX, XLSX, PNG, JPEG; 25 MB) and answers 400 with a reason. */
export const uploadClientDocument = async (
	token: string,
	clientId: string,
	file: File,
	title: string = file.name
): Promise<FinnyDocument> => {
	const data = new FormData();
	data.append('file', file);
	data.append('title', title.slice(0, 255));
	// No Content-Type header: the browser sets multipart/form-data with the boundary.
	const res = await finnyFetch(token, `/clients/${encodeURIComponent(clientId)}/documents`, {
		method: 'POST',
		body: data
	});
	if (!res.ok) throw await finnyError(res, 'Upload failed');
	return (await res.json()) as FinnyDocument;
};

export const getDocumentText = async (token: string, documentId: string): Promise<DocumentText> => {
	const res = await finnyFetch(token, `/documents/${encodeURIComponent(documentId)}/text`);
	if (!res.ok) throw await finnyError(res, 'Could not read the document');
	return (await res.json()) as DocumentText;
};

export interface WaitOptions {
	timeoutMs?: number;
	intervalMs?: number;
	sleep?: (ms: number) => Promise<void>;
	clock?: () => number;
}

/**
 * Wait for finny's ingest to finish and return the document's text.
 *
 * Ingest is a queue (BullMQ) — an upload answers before extraction starts,
 * so the first reads say PENDING/EXTRACTING/EMBEDDING. Polls until INDEXED,
 * and names the file in every failure so a planner with six uploads knows
 * which one to look at.
 */
export const waitForDocumentText = async (
	token: string,
	documentId: string,
	filename: string,
	{ timeoutMs = 120_000, intervalMs = 1500, sleep, clock }: WaitOptions = {}
): Promise<string> => {
	const wait = sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	const now = clock ?? (() => Date.now());
	const started = now();
	for (;;) {
		const t = await getDocumentText(token, documentId);
		if (t.status === 'INDEXED') {
			const text = (t.text ?? '').trim();
			if (!text) {
				throw new Error(`No text could be extracted from "${filename}". If it's a scanned image, OCR may not be configured.`);
			}
			return text;
		}
		if (t.status === 'FAILED') {
			throw new Error(`finny could not extract text from "${filename}": ${t.errorMessage ?? 'unknown error'}`);
		}
		if (now() - started >= timeoutMs) {
			throw new Error(`Timed out waiting for finny to index "${filename}" — try again in a minute.`);
		}
		await wait(intervalMs);
	}
};
