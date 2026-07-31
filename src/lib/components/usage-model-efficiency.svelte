<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import type { ModelEfficiency } from '$lib/server/data';
	import { formatUsd, formatTokens, formatCount, formatPct } from '$lib/format';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';

	// Per-model unit economics: the table behind "should we switch models".
	//
	// Total spend already has a home in the detail table; what's missing there is
	// the *rate*. A model can dominate the bill simply by being used most, which
	// says nothing about whether it's expensive per unit of work.

	let { rows }: { rows: ModelEfficiency[] } = $props();

	type SortKey =
		'model' | 'costPer1kTokens' | 'costPerRequest' | 'outputRatio' | 'cache' | 'p95' | 'cost';
	let sortBy = $state<SortKey>('costPer1kTokens');
	let desc = $state(true);

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

	function valueOf(r: ModelEfficiency, key: SortKey): number | string {
		if (key === 'model') return r.model.toLowerCase();
		if (key === 'cost') return r.costUsd;
		if (key === 'costPer1kTokens') return r.costPer1kTokens;
		if (key === 'costPerRequest') return r.costPerRequest;
		if (key === 'outputRatio') return r.outputRatio ?? -1;
		if (key === 'cache') return r.cacheReadShare;
		return r.latencyP95 ?? -1;
	}

	const sorted = $derived.by(() => {
		const dir = desc ? -1 : 1;
		return [...rows].sort((a, b) => {
			const av = valueOf(a, sortBy);
			const bv = valueOf(b, sortBy);
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
			desc = key !== 'model';
		}
	}

	// Cheapest and dearest unit price, so the extremes are findable at a glance
	// without reading every row. Only meaningful with something to compare.
	const priced = $derived(rows.filter((r) => r.costPer1kTokens > 0));
	const cheapest = $derived(
		priced.length > 1 ? Math.min(...priced.map((r) => r.costPer1kTokens)) : null
	);
	const dearest = $derived(
		priced.length > 1 ? Math.max(...priced.map((r) => r.costPer1kTokens)) : null
	);
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
								<th
									scope="col"
									class="py-2 font-medium {c.numeric ? 'text-right' : 'text-left'}"
									aria-sort={sortBy === c.key ? (desc ? 'descending' : 'ascending') : 'none'}
								>
									<button
										type="button"
										onclick={() => toggleSort(c.key)}
										title={c.hint}
										class="inline-flex items-center gap-1 transition-colors hover:text-foreground {sortBy ===
										c.key
											? 'text-foreground'
											: ''}"
									>
										{c.label}
										{#if sortBy === c.key}
											{#if desc}<ArrowDown class="size-3" />{:else}<ArrowUp class="size-3" />{/if}
										{/if}
									</button>
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each sorted as r (r.model)}
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
									<span
										class={r.costPer1kTokens > 0 && r.costPer1kTokens === cheapest
											? 'text-emerald-500'
											: r.costPer1kTokens > 0 && r.costPer1kTokens === dearest
												? 'text-destructive'
												: ''}
									>
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
			{#if cheapest !== null}
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
