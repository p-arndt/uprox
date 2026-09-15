import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { invitation, user } from '$lib/server/db/schema';
import { hasValidInvitation } from '$lib/server/members';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('hasValidInvitation (real SQL)', () => {
	let inviterId: string;

	beforeEach(async () => {
		await db.execute(sql`delete from invitation`);
		await db.execute(sql`delete from "user"`);
		const [inviter] = await db
			.insert(user)
			.values({ name: 'Owner', email: 'owner@example.com', role: 'owner' })
			.returning({ id: user.id });
		inviterId = inviter!.id;
	});

	const invite = (email: string, overrides: Partial<typeof invitation.$inferInsert> = {}) =>
		db.insert(invitation).values({
			email,
			inviterId,
			expiresAt: new Date(Date.now() + DAY_MS),
			...overrides
		});

	it('matches a pending invitation regardless of email case', async () => {
		await invite('New.Member@Example.com');
		expect(await hasValidInvitation('new.member@example.com')).toBe(true);
	});

	it('ignores expired, canceled and accepted invitations', async () => {
		await invite('expired@example.com', { expiresAt: new Date(Date.now() - DAY_MS) });
		await invite('canceled@example.com', { status: 'canceled' });
		await invite('accepted@example.com', { status: 'accepted' });

		expect(await hasValidInvitation('expired@example.com')).toBe(false);
		expect(await hasValidInvitation('canceled@example.com')).toBe(false);
		expect(await hasValidInvitation('accepted@example.com')).toBe(false);
		expect(await hasValidInvitation('stranger@example.com')).toBe(false);
	});
});
