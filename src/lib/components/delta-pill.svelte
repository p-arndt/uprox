<script lang="ts">
	import TrendingUp from '@lucide/svelte/icons/trending-up';
	import TrendingDown from '@lucide/svelte/icons/trending-down';
	import Minus from '@lucide/svelte/icons/minus';

	let {
		value,
		tone = 'neutral'
	}: {
		/** signed percentage vs the previous period, or null when there's no baseline */
		value: number | null;
		/** `cost` reads an increase as bad (red); `neutral` stays muted either way */
		tone?: 'cost' | 'neutral';
	} = $props();

	// ±0.05% counts as flat — avoids a misleading arrow on rounding noise.
	const up = $derived(value !== null && value > 0.05);
	const down = $derived(value !== null && value < -0.05);
	const cls = $derived(
		tone === 'cost'
			? up
				? 'text-destructive'
				: down
					? 'text-emerald-500'
					: 'text-muted-foreground'
			: 'text-muted-foreground'
	);
</script>

{#if value === null}
	<span class="text-xs text-muted-foreground">no prior data</span>
{:else}
	<span class="inline-flex items-center gap-0.5 text-xs font-medium tabular-nums {cls}">
		{#if up}<TrendingUp class="size-3" />{:else if down}<TrendingDown
				class="size-3"
			/>{:else}<Minus class="size-3" />{/if}
		{value > 0 ? '+' : ''}{value.toFixed(1)}%
	</span>
{/if}
