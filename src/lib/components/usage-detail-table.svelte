<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { DimensionUsageRow } from '$lib/features/usage/types';
	import { colorForSeries } from '$lib/usage-colors';
	import { isDerivedDimension, type UsageDimension } from '$lib/usage-group';
	import { formatUsd, formatTokens, formatCount, formatUsdRate } from '$lib/format';
	import { createTableState } from '$lib/state/table.svelte';
	import SortableHeader from '$lib/components/sortable-header.svelte';

	// The numeric view of the grouping — and the table view the accessibility
	// pass requires, so every figure the chart encodes in colour is also readable
	// as text. Sorting is client-side: the server already returned the full
	// (top-N) row set, so re-sorting shouldn't cost a round trip.

	let {
		rows,
		dim,
		total,
		rowLabel,
		truncated = false,
		limit
	}: {
		rows: DimensionUsageRow[];
		dim: UsageDimension;
		/** window spend across ALL traffic, so the share column is honest past top-N */
		total: number;
		/** renders a row's name cell, so each page owns its own drill-down links */
		rowLabel?: Snippet<[DimensionUsageRow, UsageDimension]>;
		truncated?: boolean;
		limit?: number;
	} = $props();

	type SortKey = 'cost' | 'requests' | 'tokens' | 'rate' | 'denied' | 'label';

	// A meter or a billing line decomposes a request rather than describing one,
	// so one request feeds several rows at once and the per-request columns would
	// print a zero that can't be right at any value. They're dropped instead.
	const perRequest = $derived(!isDerivedDimension(dim));
	// The unit price is only offered where a row really is one rate — a billing
	// line. Elsewhere every row carries a null and the column stays away.
	const hasRate = $derived(rows.some((r) => r.ratePerMtok != null));

	const COLUMNS = $derived([
		{ key: 'label', label: 'Name', numeric: false },
		{ key: 'cost', label: 'Spend', numeric: true },
		...(perRequest ? [{ key: 'requests', label: 'Requests', numeric: true }] : []),
		{ key: 'tokens', label: 'Tokens', numeric: true },
		...(hasRate ? [{ key: 'rate', label: '$/Mtok', numeric: true }] : []),
		...(perRequest ? [{ key: 'denied', label: 'Denied', numeric: true }] : [])
	] as { key: SortKey; label: string; numeric: boolean }[]);

	const tokensOf = (r: DimensionUsageRow) => r.inputTokens + r.outputTokens;

	type Ranked = { row: DimensionUsageRow; rank: number };
	const byNumber = (f: (r: DimensionUsageRow) => number) => (a: Ranked, b: Ranked) =>
		f(a.row) - f(b.row);

	// Rank is captured BEFORE sorting: the swatch has to keep matching the chart,
	// which always stacks in cost order. Sorting by requests re-orders the rows
	// but must not repaint them.
	const table = createTableState<Ranked>({
		rows: () => rows.map((r, i) => ({ row: r, rank: i })),
		sorters: {
			cost: byNumber((r) => r.costUsd),
			requests: byNumber((r) => r.requests),
			tokens: byNumber(tokensOf),
			rate: byNumber((r) => r.ratePerMtok ?? 0),
			denied: byNumber((r) => r.denied),
			label: (a, b) => a.row.label.toLowerCase().localeCompare(b.row.label.toLowerCase())
		},
		initialSort: 'cost',
		initialDir: 'desc',
		// numbers are most useful largest-first; names alphabetically
		dirFor: (key) => (key === 'label' ? 'asc' : 'desc')
	});
</script>

<div class="overflow-x-auto">
	<table class="w-full min-w-[42rem] text-sm">
		<thead>
			<tr class="border-b text-xs text-muted-foreground">
				{#each COLUMNS as c (c.key)}
					<SortableHeader
						label={c.label}
						numeric={c.numeric}
						active={table.sortKey === c.key}
						dir={table.sortDir}
						onclick={() => table.toggleSort(c.key)}
					/>
				{/each}
				<th scope="col" class="w-28 py-2 text-right font-medium">Share</th>
			</tr>
		</thead>
		<tbody>
			{#each table.visible as { row, rank } (row.key)}
				{@const share = total > 0 ? row.costUsd / total : 0}
				<tr class="border-b last:border-0 hover:bg-muted/40">
					<td class="py-2 pr-3">
						<span class="flex min-w-0 items-center gap-2">
							<span
								class="size-2.5 shrink-0 rounded-[3px]"
								style="background-color: {colorForSeries(dim, row.key, rank)}"
								aria-hidden="true"
							></span>
							{#if rowLabel}
								{@render rowLabel(row, dim)}
							{:else}
								<span class="truncate font-medium" title={row.label}>{row.label}</span>
							{/if}
							{#if row.hint}
								<span class="shrink-0 text-xs text-muted-foreground">{row.hint}</span>
							{/if}
						</span>
					</td>
					<td class="py-2 text-right font-medium tabular-nums">{formatUsd(row.costUsd)}</td>
					{#if perRequest}
						<td class="py-2 text-right tabular-nums">{formatCount(row.requests)}</td>
					{/if}
					<td class="py-2 text-right tabular-nums">{formatTokens(tokensOf(row))}</td>
					{#if hasRate}
						<td class="py-2 text-right text-muted-foreground tabular-nums">
							{formatUsdRate(row.ratePerMtok)}
						</td>
					{/if}
					{#if perRequest}
						<td class="py-2 text-right tabular-nums {row.denied > 0 ? 'text-destructive' : ''}">
							{formatCount(row.denied)}
						</td>
					{/if}
					<td class="py-2 pl-3">
						<span class="flex items-center justify-end gap-2">
							<span class="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
								<span
									class="block h-full rounded-full"
									style="width: {Math.min(100, share * 100)}%; background-color: {colorForSeries(
										dim,
										row.key,
										rank
									)}"
								></span>
							</span>
							<span class="w-10 text-right text-xs text-muted-foreground tabular-nums">
								{(share * 100).toFixed(1)}%
							</span>
						</span>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

{#if truncated && limit}
	<p class="pt-2 text-xs text-muted-foreground">
		Showing the top {limit} by spend. Narrow the window or add a filter to see the rest.
	</p>
{/if}
