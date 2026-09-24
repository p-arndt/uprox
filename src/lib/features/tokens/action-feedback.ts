/**
 * Pure routing of token form-action results: which dialog shows an error
 * inline, and which results become toasts instead.
 */

export type TokenAction = 'create' | 'update' | 'reveal' | 'revoke' | 'delete';

/** The shape every token action returns (success or `fail(...)` data). */
export interface TokenActionResult {
	action?: TokenAction;
	message?: string;
	success?: boolean;
	/** the affected token's name, when the action knows it */
	name?: string;
}

/**
 * The error for one dialog's form. Filtering by action keeps e.g. an update
 * error from showing up in the create dialog as well.
 */
export function dialogMessage(
	form: TokenActionResult | null | undefined,
	action: TokenAction
): string | undefined {
	return form?.action === action ? form.message : undefined;
}

const SUCCESS: Record<TokenAction, ((name?: string) => string) | null> = {
	create: () => 'Token created',
	update: () => 'Token saved',
	// the secret dialog opening is the feedback; a toast on top would be noise
	reveal: null,
	revoke: (name) => (name ? `Token “${name}” revoked` : 'Token revoked'),
	delete: (name) => (name ? `Token “${name}” deleted` : 'Token deleted')
};

export type Toast = { kind: 'success' | 'error'; message: string };

/**
 * The toast for an action result, if any. Errors of an action whose dialog is
 * open render inside that dialog instead, so they don't show twice.
 */
export function actionToast(
	form: TokenActionResult | null | undefined,
	openDialog: TokenAction | null
): Toast | null {
	if (!form?.action) return null;
	if (form.message) {
		return form.action === openDialog ? null : { kind: 'error', message: form.message };
	}
	const message = SUCCESS[form.action]?.(form.name);
	return message ? { kind: 'success', message } : null;
}

/** `url` minus one search param, for dropping one-shot params like `?service=`. */
export function withoutSearchParam(url: URL, key: string): URL {
	const next = new URL(url);
	next.searchParams.delete(key);
	return next;
}
