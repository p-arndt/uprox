import { db } from '$lib/server/db';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Load-balancer probe: 200 when the database answers, 503 otherwise. */
export const GET: RequestHandler = async () => {
	try {
		await db.execute('SELECT 1');
		return json({ status: 'ok' });
	} catch {
		return json({ status: 'unavailable' }, { status: 503 });
	}
};
