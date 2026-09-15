<script lang="ts">
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import type { ResolvedPathname } from '$app/types';
	import { Button } from '$lib/components/ui/button/index.js';
	import PageHeader from '$lib/components/layout/page-header.svelte';
	import PageShell from '$lib/components/layout/page-shell.svelte';
	import EmptyState from '$lib/components/layout/empty-state.svelte';
	import Waypoints from '@lucide/svelte/icons/waypoints';
	import MetaFilterBanner from './meta-filter-banner.svelte';
	import OtelTracesTable from './otel-traces-table.svelte';
	import TraceFeedToolbar from './trace-feed-toolbar.svelte';
	import TraceFeedTable from './trace-feed-table.svelte';
	import { filterFeed } from './feed-filter';

	let { data } = $props();

	let query = $state('');
	let status = $state('all');

	// metadata filter is server-side (jsonb), driven by the ?meta= URL param so it
	// also matches inside clustered sessions. Seeded from the active filter.
	let metaInput = $state(
		untrack(() =>
			data.metaFilter
				? data.metaFilter.value != null
					? `${data.metaFilter.key}:${data.metaFilter.value}`
					: data.metaFilter.key
				: ''
		)
	);
	const applyMeta = () => {
		const v = metaInput.trim();
		goto(
			v
				? (`${resolve('/app/traces')}?meta=${encodeURIComponent(v)}` as ResolvedPathname)
				: resolve('/app/traces')
		);
	};
	const clearMeta = () => {
		metaInput = '';
		goto(resolve('/app/traces'));
	};

	const filtered = $derived(filterFeed(data.feed, query, status));

	function reset() {
		query = '';
		status = 'all';
	}
</script>

<PageShell width="default">
	<PageHeader title="Traces">
		{#snippet description()}
			Captured request &amp; response payloads for gateway calls. Open a trace to inspect the
			prompt, the model's reply, and token usage.
		{/snippet}
	</PageHeader>

	{#if data.metaFilter}
		<MetaFilterBanner filter={data.metaFilter} onclear={clearMeta} />
	{/if}

	{#if data.otelTraces.length > 0}
		<OtelTracesTable traces={data.otelTraces} />
	{/if}

	{#if !data.tracingEnabled && data.feed.length === 0 && data.otelTraces.length === 0}
		<div class="flex flex-col items-center justify-center rounded-xl border border-dashed py-16">
			<Waypoints class="size-8 text-muted-foreground" />
			<p class="mt-3 text-sm font-medium">Tracing is off</p>
			<p class="max-w-sm text-center text-sm text-muted-foreground">
				Enable request tracing in Settings (or per policy) to start capturing prompts and responses
				here.
			</p>
			<Button href={resolve('/app/settings')} variant="outline" size="sm" class="mt-4">
				Go to Settings
			</Button>
		</div>
	{:else if data.feed.length === 0}
		{#if data.otelTraces.length === 0}
			<EmptyState
				icon={Waypoints}
				title="No traces yet"
				description="Traced requests will appear here as they happen."
			/>
		{/if}
	{:else}
		<h3 class="text-sm font-semibold">Gateway calls</h3>
		<TraceFeedToolbar
			bind:query
			bind:status
			bind:metaInput
			onApplyMeta={applyMeta}
			onReset={reset}
		/>
		<TraceFeedTable items={filtered} total={data.feed.length} onReset={reset} />
	{/if}
</PageShell>
