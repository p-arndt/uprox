<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import UsageDonut from '$lib/components/usage-donut.svelte';
	import { dimensionLabel, type UsageDimension } from '$lib/usage-group';
	import type { DimensionUsageRow } from '$lib/server/data';

	// Three compositions side by side rather than behind tabs. Cost analysis is a
	// comparison task — "which service, on which model, through which provider" —
	// and tabs make the reader hold one ring in memory while looking at the next.

	let {
		panels,
		metric = 'cost',
		scopeTotal = null
	}: {
		panels: { dim: UsageDimension; rows: DimensionUsageRow[] }[];
		metric?: 'cost' | 'requests' | 'tokens';
		/** window total for the metric, so each ring reconciles with the headline */
		scopeTotal?: number | null;
	} = $props();
</script>

<div class="grid gap-4 lg:grid-cols-3">
	{#each panels as p (p.dim)}
		<Card.Root>
			<Card.Header class="pb-2">
				<Card.Title class="text-sm font-medium">By {dimensionLabel(p.dim).toLowerCase()}</Card.Title
				>
			</Card.Header>
			<Card.Content>
				<UsageDonut rows={p.rows} dim={p.dim} {metric} {scopeTotal} />
			</Card.Content>
		</Card.Root>
	{/each}
</div>
