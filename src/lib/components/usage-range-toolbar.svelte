<script lang="ts">
	import CustomRangePicker from '$lib/components/custom-range-picker.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { ResolvedPathname } from '$app/types';
	import type { UsageUrlOverrides } from '$lib/usage-url';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';

	// The date-range controls shared by the usage, service-detail, and token-detail
	// headers: preset pills + custom-range popover + in-place refresh. Granularity
	// is intentionally *not* here — it lives under the trend chart it controls.
	// `hrefWith` stays page-owned (each page resolves a different base path) so the
	// resolve()/navigation lint rule is satisfied at the source.

	let {
		ranges,
		range,
		hrefWith,
		customFrom,
		customTo,
		onApplyCustom,
		onRefresh,
		refreshing = false
	}: {
		ranges: readonly { key: string; label: string }[];
		range: string;
		hrefWith: (overrides: UsageUrlOverrides) => ResolvedPathname;
		customFrom: string | null;
		customTo: string | null;
		onApplyCustom: (from: string, to: string) => void;
		onRefresh: () => void;
		refreshing?: boolean;
	} = $props();
</script>

<div class="flex flex-wrap items-center gap-2">
	<div class="flex shrink-0 flex-wrap gap-1 rounded-lg border p-0.5">
		{#each ranges as r (r.key)}
			<a
				href={hrefWith({ range: r.key })}
				data-sveltekit-noscroll
				class="rounded-md px-3 py-1 text-sm font-medium transition-colors {r.key === range
					? 'bg-accent text-accent-foreground'
					: 'text-muted-foreground hover:text-foreground'}"
			>
				{r.label}
			</a>
		{/each}
	</div>
	<CustomRangePicker
		from={customFrom}
		to={customTo}
		active={range === 'custom'}
		onApply={onApplyCustom}
	/>
	<Button
		variant="outline"
		size="icon"
		onclick={onRefresh}
		disabled={refreshing}
		aria-label="Refresh usage"
		title="Refresh"
	>
		<RefreshCw class={refreshing ? 'animate-spin' : ''} />
	</Button>
</div>
