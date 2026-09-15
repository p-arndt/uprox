<script lang="ts">
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import SearchInput from '$lib/components/form/search-input.svelte';
	import type { PriceTier } from '$lib/features/pricing/pricing';

	// Provider tabs, the rate-card (tier) switch and the model search.

	let {
		providerFilter = $bindable('all'),
		tier = $bindable('standard'),
		query = $bindable(''),
		tabs,
		total,
		longCount
	}: {
		providerFilter?: string;
		tier?: PriceTier;
		query?: string;
		tabs: { key: string; label: string; count: number }[];
		/** number of models across all providers */
		total: number;
		/** number of models with a long-context rate card */
		longCount: number;
	} = $props();
</script>

<div class="flex flex-wrap items-center justify-between gap-3">
	<Tabs.Root bind:value={providerFilter} class="min-w-0">
		<Tabs.List class="max-w-full overflow-x-auto">
			<Tabs.Trigger value="all">
				All
				<span class="ml-1.5 text-xs text-muted-foreground">{total}</span>
			</Tabs.Trigger>
			{#each tabs as t (t.key)}
				<Tabs.Trigger value={t.key}>
					{t.label}
					<span class="ml-1.5 text-xs text-muted-foreground">{t.count}</span>
				</Tabs.Trigger>
			{/each}
		</Tabs.List>
	</Tabs.Root>

	<div class="flex flex-wrap items-center gap-3">
		<Tabs.Root bind:value={tier} class="min-w-0">
			<Tabs.List class="max-w-full overflow-x-auto">
				<Tabs.Trigger value="standard">Short context</Tabs.Trigger>
				<Tabs.Trigger value="long">
					Long context
					<span class="ml-1.5 text-xs text-muted-foreground">{longCount}</span>
				</Tabs.Trigger>
			</Tabs.List>
		</Tabs.Root>

		<SearchInput
			bind:value={query}
			placeholder="Search models…"
			class="w-full max-w-xs sm:w-64"
			ariaLabel="Search models"
		/>
	</div>
</div>
