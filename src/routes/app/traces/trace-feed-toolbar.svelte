<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import SearchInput from '$lib/components/form/search-input.svelte';
	import SelectField from '$lib/components/form/select-field.svelte';
	import Filter from '@lucide/svelte/icons/filter';
	import X from '@lucide/svelte/icons/x';
	import { statusOptions } from './feed-filter';

	// Search, metadata filter and status select above the gateway-call feed.

	let {
		query = $bindable(''),
		status = $bindable('all'),
		metaInput = $bindable(''),
		onApplyMeta,
		onReset
	}: {
		query?: string;
		status?: string;
		/** the metadata filter draft; applied (server-side) on Enter */
		metaInput?: string;
		onApplyMeta: () => void;
		onReset: () => void;
	} = $props();

	const hasFilters = $derived(query.trim() !== '' || status !== 'all');
</script>

<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
	<SearchInput bind:value={query} placeholder="Search model, service, provider…" class="flex-1" />
	<div class="relative sm:w-60">
		<Filter
			class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
		/>
		<Input
			bind:value={metaInput}
			onkeydown={(e) => e.key === 'Enter' && onApplyMeta()}
			placeholder="metadata e.g. user_id:u_42"
			class="pl-9"
		/>
	</div>
	<SelectField
		name="status"
		bind:value={status}
		options={statusOptions}
		fallback=""
		class="w-full sm:w-40"
	/>
	{#if hasFilters}
		<Button variant="ghost" size="sm" onclick={onReset} class="shrink-0">
			<X class="size-4" /> Clear
		</Button>
	{/if}
</div>
