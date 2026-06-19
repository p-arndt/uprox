/**
 * Reusable client-side table state: a free-text query, a column sort, and an
 * optional external filter predicate, combined into a single derived `visible`
 * list. Pages own *what* a row is and *how* it matches/sorts; this owns the
 * bookkeeping (current query, sort key + direction, toggle behaviour) that was
 * otherwise copy-pasted into every list page.
 *
 * Lives in a `.svelte.ts` module so the runes ($state/$derived) are reactive
 * when the returned object is read from a component.
 */

export interface TableStateOptions<T> {
	/** reactive source rows (pass a getter so updates flow through) */
	rows: () => T[];
	/** whether a row matches the (already lowercased, trimmed) query */
	matches?: (row: T, query: string) => boolean;
	/** an extra predicate built from external reactive state (e.g. a tab filter) */
	predicate?: () => (row: T) => boolean;
	/** comparator per sort key; the active one is applied ascending then negated */
	sorters: Record<string, (a: T, b: T) => number>;
	/** the column sorted on first render */
	initialSort: string;
	initialDir?: 'asc' | 'desc';
	/** the default direction when switching to a column (defaults to 'asc') */
	dirFor?: (key: string) => 'asc' | 'desc';
}

export interface TableState<T> {
	query: string;
	readonly sortKey: string;
	readonly sortDir: 'asc' | 'desc';
	readonly visible: T[];
	toggleSort(key: string): void;
}

export function createTableState<T>(opts: TableStateOptions<T>): TableState<T> {
	let query = $state('');
	let sortKey = $state(opts.initialSort);
	let sortDir = $state<'asc' | 'desc'>(opts.initialDir ?? 'asc');

	const visible = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const pred = opts.predicate?.();
		const filtered = opts.rows().filter((r) => {
			if (pred && !pred(r)) return false;
			if (q && opts.matches && !opts.matches(r, q)) return false;
			return true;
		});
		const cmp = opts.sorters[sortKey];
		if (!cmp) return filtered;
		const dir = sortDir === 'asc' ? 1 : -1;
		return [...filtered].sort((a, b) => cmp(a, b) * dir);
	});

	return {
		get query() {
			return query;
		},
		set query(v: string) {
			query = v;
		},
		get sortKey() {
			return sortKey;
		},
		get sortDir() {
			return sortDir;
		},
		get visible() {
			return visible;
		},
		toggleSort(key: string) {
			if (sortKey === key) {
				sortDir = sortDir === 'asc' ? 'desc' : 'asc';
			} else {
				sortKey = key;
				sortDir = opts.dirFor?.(key) ?? 'asc';
			}
		}
	};
}
