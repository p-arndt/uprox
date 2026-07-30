<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { DimensionUsageRow } from '$lib/server/data';
	import { colorForSeries } from '$lib/usage-colors';
	import { formatUsd, formatTokens, formatCount } from '$lib/format';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';

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
		dim: string;
		/** window spend across ALL traffic, so the share column is honest past top-N */
		total: number;
		/** renders a row's name cell, so each page owns its own drill-down links */
		rowLabel?: Snippet<[DimensionUsageRow, string]>;
		truncated?: boolean;
		limit?: number;
	} = $props();

	type SortKey = 'cost' | 'requests' | 'tokens' | 'denied' | 'label';
	let sortBy = $state<SortKey>('cost');
	let desc = $state(true);

	const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
		{ key: 'label', label: 'Name', numeric: false },
		{ key: 'cost', label: 'Spend', numeric: true },
		{ key: 'requests', label: 'Requests', numeric: true },
		{ key: 'tokens', label: 'Tokens', numeric: true },
		{ key: 'denied', label: 'Denied', numeric: true }
	];

	const tokensOf = (r: DimensionUsageRow) => r.inputTokens + r.outputTokens;

	function valueOf(r: DimensionUsageRow, key: SortKey): number | string {
		if (key === 'cost') return r.costUsd;
		if (key === 'requests') return r.requests;
		if (key === 'tokens') return tokensOf(r);
		if (key === 'denied') return r.denied;
		return r.label.toLowerCase();
	}

	// Rank is captured BEFORE sorting: the swatch has to keep matching the chart,
	// which always stacks in cost order. Sorting by requests re-orders the rows
	// but must not repaint them.
	const ranked = $derived(rows.map((r, i) => ({ row: r, rank: i })));

	const sorted = $derived.by(() => {
		const dir = desc ? -1 : 1;
		return [...ranked].sort((a, b) => {
			const av = valueOf(a.row, sortBy);
			const bv = valueOf(b.row, sortBy);
			if (typeof av === 'string' || typeof bv === 'string') {
				return String(av).localeCompare(String(bv)) * dir;
			}
			return (av - bv) * dir;
		});
	});

	function toggleSort(key: SortKey) {
		if (sortBy === key) desc = !desc;
		else {
			sortBy = key;
			// numbers are most useful largest-first; names alphabetically
			desc = key !== 'label';
		}
	}
</script>

<div class="overflow-x-auto">
	<table class="w-full min-w-[42rem] text-sm">
		<thead>
			<tr class="border-b text-xs text-muted-foreground">
				{#each COLUMNS as c (c.key)}
					<th
						scope="col"
						class="py-2 font-medium {c.numeric ? 'text-right' : 'text-left'}"
						aria-sort={sortBy === c.key ? (desc ? 'descending' : 'ascending') : 'none'}
					>
						<button
							type="button"
							onclick={() => toggleSort(c.key)}
							class="inline-flex items-center gap-1 transition-colors hover:text-foreground {sortBy ===
							c.key
								? 'text-foreground'
								: ''}"
						>
							{c.label}
							{#if sortBy === c.key}
								{#if desc}
									<ArrowDown class="size-3" />
								{:else}
									<ArrowUp class="size-3" />
								{/if}
							{/if}
						</button>
					</th>
				{/each}
				<th scope="col" class="w-28 py-2 text-right font-medium">Share</th>
			</tr>
		</thead>
		<tbody>
			{#each sorted as { row, rank } (row.key)}
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
					<td class="py-2 text-right tabular-nums">{formatCount(row.requests)}</td>
					<td class="py-2 text-right tabular-nums">{formatTokens(tokensOf(row))}</td>
					<td class="py-2 text-right tabular-nums {row.denied > 0 ? 'text-destructive' : ''}">
						{formatCount(row.denied)}
					</td>
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
