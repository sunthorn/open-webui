// Forced password change (admin-created / admin-reset accounts).
// The backend answers 403 {"detail": "PASSWORD_CHANGE_REQUIRED"} for every
// authenticated call except the few needed to finish the change.

export const PASSWORD_CHANGE_REQUIRED = 'PASSWORD_CHANGE_REQUIRED';
export const CHANGE_PASSWORD_PATH = '/auth/change-password';

/** Same-origin relative path only, and never back into the auth pages.
 *  Resolved with the URL parser, not prefix checks: it drops tab/newline and
 *  folds backslashes, so "/\t/evil" would otherwise slip past as "//evil". */
export const safeRedirect = (target: string | null | undefined): string => {
	if (!target || !target.startsWith('/')) return '/';
	const base = 'http://same.invalid';
	let url: URL;
	try {
		url = new URL(target, base);
	} catch {
		return '/';
	}
	if (url.origin !== base) return '/';
	if (url.pathname === '/auth' || url.pathname.startsWith('/auth/')) return '/';
	const path = `${url.pathname}${url.search}${url.hash}`;
	// A path that itself starts with "//" would read as protocol-relative later.
	return path.startsWith('//') ? '/' : path;
};

export const changePasswordUrl = (redirect: string | null | undefined): string => {
	const target = safeRedirect(redirect);
	return target === '/'
		? CHANGE_PASSWORD_PATH
		: `${CHANGE_PASSWORD_PATH}?redirect=${encodeURIComponent(target)}`;
};

export const isPasswordChangeRequiredResponse = async (res: Response): Promise<boolean> => {
	if (res.status !== 403) return false;
	try {
		const body = await res.clone().json();
		return body?.detail === PASSWORD_CHANGE_REQUIRED;
	} catch {
		return false;
	}
};

/** Returns a fetch that calls onRequired whenever the backend reports the marker. */
export const wrapFetch = (baseFetch: typeof fetch, onRequired: () => void): typeof fetch => {
	return async (...args: Parameters<typeof fetch>) => {
		const res = await baseFetch(...args);
		if (await isPasswordChangeRequiredResponse(res)) {
			onRequired();
		}
		return res;
	};
};

let installed = false;

/** Patch window.fetch once so every API wrapper is covered without touching each one. */
export const installPasswordChangeInterceptor = (onRequired: () => void) => {
	if (installed || typeof window === 'undefined') return;
	installed = true;
	window.fetch = wrapFetch(window.fetch.bind(window), onRequired);
};
