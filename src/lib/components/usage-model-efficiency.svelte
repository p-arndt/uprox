<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import type { ModelEfficiency } from '$lib/server/data';
	import { formatUsd, formatTokens, formatCount, formatPct } from '$lib/format';
	import { priceExtreme, priceExtremes } from '$lib/features/usage/efficiency';
	import { createTableState } from '$lib/state/table.svelte';
	import SortableHeader from '$lib/components/sortable-header.svelte';

	// Per-model unit economics: the table behind "should we switch models".
	//
	// Total spend already has a home in the detail table; what's missing there is
	// the *rate*. A model can dominate the bill simply by being used most, which
	// says nothing about whether it's expensive per unit of work.

	let { rows }: { rows: ModelEfficiency[] } = $props();

	type SortKey =
		'model' | 'costPer1kTokens' | 'costPerRequest' | 'outputRatio' | 'cache' | 'p95' | 'cost';

	const COLUMNS: { key: SortKey; label: string; numeric: boolean; hint?: string }[] = [
		{ key: 'model', label: 'Model', numeric: false },
		{ key: 'cost', label: 'Spend', numeric: true },
		{
			key: 'costPer1kTokens',
			label: '$ / 1K tok',
			numeric: true,
			hint: 'Unit price across input + output — the comparable figure between models'
		},
		{ key: 'costPerRequest', label: '$ / req', numeric: true },
		{
			key: 'outputRatio',
			label: 'out:in',
			numeric: true,
			hint: 'Output ÷ input tokens. A cheap model that answers at twice the length is not cheaper.'
		},
		{
			key: 'cache',
			label: 'Cache',
			numeric: true,
			hint: 'Share of input served from the prompt cache'
		},
		{ key: 'p95', label: 'p95', numeric: true, hint: '95th-percentile upstream latency' }
	];

	const byNumber =
		(f: (r: ModelEfficiency) => number) => (a: ModelEfficiency, b: ModelEfficiency) =>
			f(a) - f(b);

	const table = createTableState<ModelEfficiency>({
		rows: () => rows,
		sorters: {
			model: (a, b) => a.model.toLowerCase().localeCompare(b.model.toLowerCase()),
			cost: byNumber((r) => r.costUsd),
			costPer1kTokens: byNumber((r) => r.costPer1kTokens),
			costPerRequest: byNumber((r) => r.costPerRequest),
			outputRatio: byNumber((r) => r.outputRatio ?? -1),
			cache: byNumber((r) => r.cacheReadShare),
			p95: byNumber((r) => r.latencyP95 ?? -1)
		},
		initialSort: 'costPer1kTokens',
		initialDir: 'desc',
		dirFor: (key) => (key === 'model' ? 'asc' : 'desc')
	});

	// Cheapest and dearest unit price, so the extremes are findable at a glance
	// without reading every row. Only meaningful with something to compare.
	const extremes = $derived(priceExtremes(rows));
	const EXTREME_CLASS = { cheapest: 'text-emerald-500', dearest: 'text-destructive', none: '' };
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>Model efficiency</Card.Title>
		<Card.Description>
			Unit economics per model — what each one costs per unit of work, rather than in total.
		</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if rows.length === 0}
			<p class="py-6 text-center text-sm text-muted-foreground">No model traffic in this window.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full min-w-[46rem] text-sm">
					<thead>
						<tr class="border-b text-xs text-muted-foreground">
							{#each COLUMNS as c (c.key)}
								<SortableHeader
									label={c.label}
									numeric={c.numeric}
									hint={c.hint}
									active={table.sortKey === c.key}
									dir={table.sortDir}
									onclick={() => table.toggleSort(c.key)}
								/>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each table.visible as r (r.model)}
							<tr class="border-b last:border-0 hover:bg-muted/40">
								<td class="py-2 pr-3">
									<span class="flex min-w-0 items-baseline gap-2">
										<span class="truncate font-mono text-[13px] font-medium" title={r.model}>
											{r.model}
										</span>
										{#if r.provider}
											<span class="shrink-0 text-xs text-muted-foreground">{r.provider}</span>
										{/if}
									</span>
									<span class="text-xs text-muted-foreground tabular-nums">
										{formatCount(r.requests)} req · {formatTokens(r.inputTokens + r.outputTokens)} tok
									</span>
								</td>
								<td class="py-2 text-right tabular-nums">{formatUsd(r.costUsd)}</td>
								<td class="py-2 text-right font-medium tabular-nums">
									<span class={EXTREME_CLASS[priceExtreme(r.costPer1kTokens, extremes) ?? 'none']}>
										{formatUsd(r.costPer1kTokens)}
									</span>
								</td>
								<td class="py-2 text-right tabular-nums">{formatUsd(r.costPerRequest)}</td>
								<td class="py-2 text-right tabular-nums">
									{r.outputRatio === null ? '—' : r.outputRatio.toFixed(2)}
								</td>
								<td class="py-2 text-right tabular-nums">
									{r.cacheReadShare > 0 ? formatPct(r.cacheReadShare, 0) : '—'}
								</td>
								<td class="py-2 text-right tabular-nums">
									{r.latencyP95 === null ? '—' : `${(r.latencyP95 / 1000).toFixed(2)}s`}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if extremes.cheapest !== null}
				<p class="pt-2 text-xs text-muted-foreground">
					Cheapest and dearest unit price are highlighted. Compare
					<span class="font-medium">$ / 1K tok</span> alongside
					<span class="font-medium">out:in</span> — a low rate with a high output ratio can still cost
					more per answer.
				</p>
			{/if}
		{/if}
	</Card.Content>
</Card.Root>
