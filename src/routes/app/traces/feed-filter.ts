/** Client-side filtering of the traces feed (clustered sessions and standalone calls). */
import { eventTone, type EventTone } from '$lib/events';

interface SessionEntry {
	kind: 'session';
	groupId: string | null;
	serviceName: string | null;
	models: string[] | null;
	errorCount: number;
}

interface CallEntry {
	kind: 'call';
	id: string;
	action: string | null;
	status: string;
	model: string | null;
	serviceName: string | null;
	provider: string | null;
	detail: string | null;
	metadata: unknown;
}

/** The fields of a feed entry the filters read, discriminated by `kind`. */
export type FeedEntry = SessionEntry | CallEntry;

export const statusOptions = [
	{ value: 'all', label: 'All statuses' },
	{ value: 'ok', label: 'Succeeded' },
	{ value: 'denied', label: 'Denied' },
	{ value: 'error', label: 'Errors' }
];

/** A session reads as an error when any of its calls failed. */
export const feedTone = (it: FeedEntry): EventTone =>
	it.kind === 'session' ? (it.errorCount > 0 ? 'error' : 'ok') : eventTone(it.status);

/** A stable key across both entry kinds. */
export const feedKey = (it: FeedEntry): string =>
	it.kind === 'session' ? `g:${it.groupId}` : `c:${it.id}`;

/** The lowercased text the search box matches against. */
export function feedHaystack(it: FeedEntry): string {
	return (
		it.kind === 'session'
			? ['session', it.groupId, it.serviceName, ...(it.models ?? [])]
			: [
					it.action,
					it.status,
					it.model,
					it.serviceName,
					it.provider,
					it.detail,
					it.metadata ? JSON.stringify(it.metadata) : null
				]
	)
		.filter(Boolean)
		.join(' ')
		.toLowerCase();
}

/** Entries matching the status filter ('all' or a tone) and the free-text query. */
export function filterFeed<T extends FeedEntry>(items: T[], query: string, status: string): T[] {
	const q = query.trim().toLowerCase();
	return items.filter((it) => {
		if ((status === 'ok' || status === 'denied' || status === 'error') && feedTone(it) !== status)
			return false;
		if (q && !feedHaystack(it).includes(q)) return false;
		return true;
	});
}
