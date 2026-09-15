/** Encrypted upstream provider credentials. */
import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { providerSecret } from '$lib/server/db/schema';
import { encrypt } from '$lib/server/crypto';
import { audit } from '$lib/server/audit';

export function listProviderSecrets() {
	return (
		db
			.select({
				id: providerSecret.id,
				provider: providerSecret.provider,
				label: providerSecret.label,
				baseUrl: providerSecret.baseUrl,
				priority: providerSecret.priority,
				hint: providerSecret.hint,
				createdAt: providerSecret.createdAt,
				updatedAt: providerSecret.updatedAt
			})
			.from(providerSecret)
			// group a provider's secrets together, highest priority first
			.orderBy(providerSecret.provider, desc(providerSecret.priority), providerSecret.createdAt)
	);
}

/**
 * Add a provider secret. A provider may hold several (e.g. one per Azure OpenAI
 * resource), so this always inserts a new row — services pick among them via
 * their pinned secret, and the default is the highest-priority one.
 */
export async function createProviderSecret(
	userId: string,
	input: { provider: string; secret: string; label?: string; baseUrl?: string; priority?: number }
) {
	const hint = input.secret.slice(-4);
	const baseUrl = input.baseUrl?.trim() || null;
	const [row] = await db
		.insert(providerSecret)
		.values({
			provider: input.provider,
			label: input.label || null,
			baseUrl,
			priority: input.priority ?? 0,
			encryptedSecret: encrypt(input.secret),
			hint,
			createdByUserId: userId
		})
		.returning({ id: providerSecret.id, provider: providerSecret.provider });

	await audit({
		action: 'provider.create',
		status: 'ok',
		provider: input.provider,
		detail: input.label || input.provider
	});
	return row;
}

/**
 * Update a provider secret in place. Only the fields present in `input` are
 * written, so the label/endpoint/priority can be edited independently of
 * rotating the key (pass `secret` to rotate; the hint follows it). A defined but
 * empty `secret` clears the credential — used by optional-auth providers (Ollama)
 * to drop basic auth; an omitted `secret` leaves the stored key untouched.
 */
export async function updateProviderSecret(
	id: string,
	input: { label?: string | null; baseUrl?: string | null; priority?: number; secret?: string }
) {
	const set: Partial<typeof providerSecret.$inferInsert> = { updatedAt: new Date() };
	if (input.label !== undefined) set.label = input.label || null;
	if (input.baseUrl !== undefined) set.baseUrl = input.baseUrl?.trim() || null;
	if (input.priority !== undefined) set.priority = input.priority;
	const rotating = input.secret !== undefined;
	if (rotating) {
		set.encryptedSecret = encrypt(input.secret!);
		set.hint = input.secret!.slice(-4);
	}
	const [row] = await db
		.update(providerSecret)
		.set(set)
		.where(eq(providerSecret.id, id))
		.returning({ id: providerSecret.id, provider: providerSecret.provider });
	if (row) {
		await audit({
			action: rotating ? 'provider.rotate' : 'provider.update',
			status: 'ok',
			provider: row.provider,
			detail: row.provider
		});
	}
	return row ?? null;
}

/**
 * Delete a provider secret and audit it. Returns whether a row was removed, so
 * callers can tell a stale id from a real deletion; nothing is audited for an
 * unknown id.
 */
export async function deleteProviderSecret(id: string): Promise<boolean> {
	const [row] = await db
		.delete(providerSecret)
		.where(eq(providerSecret.id, id))
		.returning({ provider: providerSecret.provider, label: providerSecret.label });
	if (!row) return false;
	await audit({
		action: 'provider.delete',
		status: 'ok',
		provider: row.provider,
		detail: row.label || row.provider
	});
	return true;
}
