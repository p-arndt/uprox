/** Display helpers for the service list and detail pages. */
import { tokenStatus, type Token } from '$lib/features/tokens/tokens';
import { DEFAULT_SERVICE_NAME } from '$lib/features/tokens/token-helpers';

/** Shared by the form's select and the list/detail badges so both say the same thing. */
export const SERVICE_TYPE_OPTIONS = [
	{ value: 'app', label: 'App' },
	{ value: 'agent', label: 'Agent' },
	{ value: 'workload', label: 'Workload' }
];

/** The form's label for a stored type; unknown values (e.g. set via the API) pass through. */
export function serviceTypeLabel(type: string): string {
	return SERVICE_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

/** Confirmation copy for deleting a service, which revokes all of its tokens. */
export function deleteServiceDescription(activeTokens: number, name?: string): string {
	const tail = "This can't be undone.";
	const head =
		activeTokens === 0
			? 'This service has no active tokens.'
			: `${activeTokens} ${activeTokens === 1 ? 'active token' : 'active tokens'} will be revoked and stop working immediately.`;
	// Token creation falls back to the service named "Default" and recreates it
	// when missing, so deleting it doesn't stop tokens from landing there.
	const defaultNote =
		name === DEFAULT_SERVICE_NAME
			? ' New tokens created without a service will land in a freshly created, empty Default service — without the limits or preset this one has.'
			: '';
	return `${head}${defaultNote} ${tail}`;
}

/** A form action result as the page sees it, tagged with the action that produced it. */
export interface ActionResult {
	action?: string;
	message?: string;
	success?: boolean;
}

/**
 * The error message `action` returned, if any. `dismissed` is the result the user
 * already closed the dialog on, so reopening it doesn't show a stale error.
 */
export function actionError(
	form: ActionResult | null | undefined,
	action: string,
	dismissed?: ActionResult | null
): string | undefined {
	if (!form || form === dismissed || form.action !== action || form.success) return undefined;
	return form.message;
}

/** Active tokens first; revoked and expired ones go behind a toggle. Order is kept within each part. */
export function partitionTokens<T extends Pick<Token, 'revokedAt' | 'expiresAt'>>(
	tokens: T[]
): { active: T[]; inactive: T[] } {
	const active: T[] = [];
	const inactive: T[] = [];
	for (const t of tokens) (tokenStatus(t).label === 'active' ? active : inactive).push(t);
	return { active, inactive };
}

export const SUCCESS_MESSAGES: Record<string, string> = {
	create: 'Service created',
	update: 'Service updated',
	delete: 'Service deleted'
};
