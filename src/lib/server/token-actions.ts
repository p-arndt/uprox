/**
 * Form actions shared by the token list and token detail pages, so both parse
 * the same fields and enforce the same permission.
 */
import { fail, type RequestEvent } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/org';
import { deleteToken, revokeToken, updateToken } from '$lib/server/tokens-admin';
import { getOrCreateDefaultService } from '$lib/server/services';
import { inlineFromForm, splitList } from '$lib/server/parse-config';

const DAY_MS = 86_400_000;

/** The "Expires" select value that leaves a token's expiry untouched. */
export const KEEP_EXPIRY = 'keep';

/**
 * The `expiresInDays` select: `undefined` keeps the current expiry (absent,
 * blank or "keep"), `0` means never, a positive day count is measured from `now`.
 */
export function expiryFromForm(
	value: FormDataEntryValue | null,
	now = Date.now()
): Date | null | undefined {
	const raw = value?.toString().trim() ?? '';
	if (raw === '' || raw === KEEP_EXPIRY) return undefined;
	const days = Number(raw);
	if (!Number.isFinite(days) || days <= 0) return null;
	return new Date(now + days * DAY_MS);
}

/**
 * The edit form's re-copy switch. Only turning it off is meaningful: the
 * plaintext of a hash-only token is gone, so "on" can never be restored.
 */
export function recopyFromForm(value: FormDataEntryValue | null): false | undefined {
	return value?.toString() === 'false' ? false : undefined;
}

/** The token being acted on: the route's own id on a detail page, else the form's hidden `id`. */
function targetId(data: FormData, routeId: string | undefined) {
	return routeId ?? (data.get('id')?.toString() || undefined);
}

export async function updateTokenAction(event: RequestEvent, routeId?: string) {
	await requirePermission(event, 'tokens:manage');
	const data = await event.request.formData();
	const id = targetId(data, routeId);
	const name = data.get('name')?.toString().trim();
	if (!id) return fail(400, { action: 'update' as const, message: 'Missing token id' });
	if (!name) return fail(400, { action: 'update' as const, message: 'Name is required' });

	// absent = the picker wasn't rendered, so keep the service; blank = the
	// Default service didn't exist when the form loaded, so resolve it now
	const rawServiceId = data.get('serviceId');
	const serviceId =
		rawServiceId === null
			? undefined
			: rawServiceId.toString() || (await getOrCreateDefaultService())?.id;
	const expiresAt = expiryFromForm(data.get('expiresInDays'));
	const recopyable = recopyFromForm(data.get('recopyable'));
	try {
		await updateToken(id, {
			name,
			...(serviceId ? { serviceId } : {}),
			scopes: data.getAll('scopes').map((s) => s.toString()),
			allowedModels: splitList(data.get('allowedModels')),
			policyId: data.get('policyId')?.toString() || null,
			...(expiresAt !== undefined ? { expiresAt } : {}),
			...(recopyable !== undefined ? { recopyable } : {}),
			...inlineFromForm(data)
		});
	} catch (err) {
		return fail(400, {
			action: 'update' as const,
			message: err instanceof Error ? err.message : 'Failed to update token'
		});
	}
	return { success: true };
}

export async function revokeTokenAction(event: RequestEvent, routeId?: string) {
	await requirePermission(event, 'tokens:manage');
	const id = targetId(await event.request.formData(), routeId);
	if (id) await revokeToken(id);
	return { success: true };
}

export async function deleteTokenAction(event: RequestEvent, routeId?: string) {
	await requirePermission(event, 'tokens:manage');
	const id = targetId(await event.request.formData(), routeId);
	if (id) await deleteToken(id);
	return { success: true };
}
