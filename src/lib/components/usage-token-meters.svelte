<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import type { TokenMeterBreakdown } from '$lib/server/data';
	import { formatTokens, formatUsd, formatPct } from '$lib/format';
	import { METER_COLOR, METER_META } from '$lib/usage-colors';
	import Info from '@lucide/svelte/icons/info';

	// Token volume decomposed into its billing meters, the way a cloud bill
	// itemises a resource into metered sub-lines rather than one lump.
	//
	// This replaced a pair of "exclude embedding tokens" / "exclude cache hits"
	// toggles. Those could only ever subtract: they told you the total was
	// somehow wrong without ever showing what it was made of, and two people
	// reading the same page with different toggle states saw different headline
	// numbers. A composition is strictly more informative and always adds up.

	// Deliberately no over-time chart here: "Group by: Token meter" renders the
	// meters through the main cost-analysis chart, with the granularity, tooltip
	// and metric controls that come with it. A second, lesser copy of the same
	// thing buried at the bottom of this card was redundant.
	let {
		breakdown,
		title = 'Token meters',
		description = 'What the token volume is made of, and what each caching layer avoided.'
	}: {
		breakdown: TokenMeterBreakdown;
		title?: string;
		description?: string;
	} = $props();

	const total = $derived(breakdown.totalTokens);
	const rows = $derived(
		breakdown.meters
			.filter((m) => m.tokens > 0)
			.map((m) => ({
				...m,
				...METER_META[m.key],
				color: METER_COLOR[m.key],
				share: total > 0 ? m.tokens / total : 0
			}))
	);

	const totalSaved = $derived(breakdown.savedUsd + breakdown.providerCacheSavedUsd);
	// What the window would have cost with neither cache layer — the "list price"
	// against which the actual spend is the discounted figure.
	const listCost = $derived(breakdown.costUsd + totalSaved);
	const savedShare = $derived(listCost > 0 ? totalSaved / listCost : 0);
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{title}</Card.Title>
		<Card.Description>{description}</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-5">
		{#if total === 0}
			<p class="py-6 text-center text-sm text-muted-foreground">No token volume in this window.</p>
		{:else}
			<!-- Composition bar: the whole window's tokens, to scale. 2px surface
			     gaps keep adjacent meters legible without an outline. -->
			<div class="flex h-3 gap-0.5 overflow-hidden rounded-full">
				{#each rows as r (r.key)}
					<div
						style="width: {r.share * 100}%; background-color: {r.color}"
						title="{r.label}: {formatTokens(r.tokens)}"
					></div>
				{/each}
			</div>

			<ul class="space-y-2.5">
				{#each rows as r (r.key)}
					<li class="flex items-baseline gap-2.5 text-sm">
						<span
							class="size-2.5 shrink-0 translate-y-0.5 rounded-[3px]"
							style="background-color: {r.color}"
							aria-hidden="true"
						></span>
						<span class="min-w-0 flex-1">
							<span class="font-medium">{r.label}</span>
							<span class="ml-2 text-xs text-muted-foreground">{r.hint}</span>
						</span>
						<span class="shrink-0 tabular-nums">{formatTokens(r.tokens)}</span>
						<span class="w-12 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
							{formatPct(r.share)}
						</span>
					</li>
				{/each}
				<!-- The meters partition the window exactly, so the total is worth
				     stating: it's the same figure as the "Total tokens" headline card,
				     which makes the decomposition checkable rather than asserted. -->
				<li class="flex items-baseline gap-2.5 border-t pt-2.5 text-sm">
					<span class="size-2.5 shrink-0" aria-hidden="true"></span>
					<span class="min-w-0 flex-1 font-medium">Total tokens</span>
					<span class="shrink-0 font-semibold tabular-nums">{formatTokens(total)}</span>
					<span class="w-12 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
						100%
					</span>
				</li>
			</ul>

			<!-- Actual vs list. The saving is the reason the meters matter: cache
			     reads are billed at a fraction of fresh input, so a high cache-read
			     share is the thing an operator is trying to engineer for. -->
			<div class="grid gap-4 border-t pt-4 sm:grid-cols-3">
				<div>
					<p class="text-xs text-muted-foreground">Actual spend</p>
					<p class="mt-0.5 text-xl font-semibold tabular-nums">{formatUsd(breakdown.costUsd)}</p>
				</div>
				<div>
					<p class="text-xs text-muted-foreground">Without caching</p>
					<p class="mt-0.5 text-xl font-semibold text-muted-foreground tabular-nums">
						{formatUsd(listCost)}
					</p>
				</div>
				<div>
					<p class="text-xs text-muted-foreground">Avoided by cache</p>
					<p
						class="mt-0.5 text-xl font-semibold tabular-nums"
						style="color: {METER_COLOR.cacheRead}"
					>
						{formatUsd(totalSaved)}
						{#if savedShare > 0}
							<span class="text-sm font-normal">({formatPct(savedShare, 0)})</span>
						{/if}
					</p>
				</div>
			</div>

			<div class="space-y-1.5 text-xs text-muted-foreground">
				<p class="flex gap-1.5">
					<Info class="mt-0.5 size-3.5 shrink-0" />
					<span>
						<span class="font-medium text-foreground">{formatUsd(breakdown.savedUsd)}</span> from
						uprox's response cache ({formatTokens(breakdown.savedInputTokens)} input tokens never sent
						upstream) — an exact figure, recorded per replayed request.
					</span>
				</p>
				<p class="flex gap-1.5">
					<Info class="mt-0.5 size-3.5 shrink-0" />
					<span>
						<span class="font-medium text-foreground"
							>{formatUsd(breakdown.providerCacheSavedUsd)}</span
						>
						from the provider's prompt cache — estimated, by pricing cache-read tokens at the difference
						between each model's input and cache-read rate. Providers bill the discount without itemising
						it.
					</span>
				</p>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
