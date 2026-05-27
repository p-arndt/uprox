<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { formatDateTime, relativeTime, formatUsd } from '$lib/format';
	import { eventTone, toneDot, toneText, actionIcon, isGatewayAction } from '$lib/events';
	import ScrollText from '@lucide/svelte/icons/scroll-text';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';

	let { data } = $props();

	let query = $state('');
	let status = $state('all');
	let kind = $state('all');

	const statusOptions = [
		{ value: 'all', label: 'All statuses' },
		{ value: 'ok', label: 'Succeeded' },
		{ value: 'denied', label: 'Denied' },
		{ value: 'error', label: 'Errors' }
	];
	const kindOptions = [
		{ value: 'all', label: 'All events' },
		{ value: 'gateway', label: 'Gateway' },
		{ value: 'admin', label: 'Admin' }
	];
	const statusLabel = $derived(statusOptions.find((o) => o.value === status)?.label ?? '');
	const kindLabel = $derived(kindOptions.find((o) => o.value === kind)?.label ?? '');

	const filtered = $derived(
		data.entries.filter((e) => {
			const tone = eventTone(e.status);
			if (status === 'ok' && tone !== 'ok') return false;
			if (status === 'denied' && tone !== 'denied') return false;
			if (status === 'error' && tone !== 'error') return false;
			if (kind === 'gateway' && !isGatewayAction(e.action)) return false;
			if (kind === 'admin' && isGatewayAction(e.action)) return false;
			if (query.trim()) {
				const q = query.toLowerCase();
				const haystack = [e.action, e.status, e.model, e.serviceName, e.detail, e.ip]
					.filter(Boolean)
					.join(' ')
					.toLowerCase();
				if (!haystack.includes(q)) return false;
			}
			return true;
		})
	);

	const hasFilters = $derived(query.trim() !== '' || status !== 'all' || kind !== 'all');

	function reset() {
		query = '';
		status = 'all';
		kind = 'all';
	}
</script>

<div class="mx-auto max-w-6xl space-y-6">
	<div>
		<h2 class="text-xl font-semibold tracking-tight">Audit Log</h2>
		<p class="text-sm text-muted-foreground">
			Append-only record of gateway requests and administrative actions.
		</p>
	</div>

	{#if data.entries.length === 0}
		<div class="flex flex-col items-center justify-center rounded-xl border border-dashed py-16">
			<ScrollText class="size-8 text-muted-foreground" />
			<p class="mt-3 text-sm font-medium">No events yet</p>
			<p class="text-sm text-muted-foreground">Activity will appear here as it happens.</p>
		</div>
	{:else}
		<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
			<div class="relative flex-1">
				<Search
					class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input bind:value={query} placeholder="Search action, model, service, IP…" class="pl-9" />
			</div>
			<Select.Root type="single" bind:value={kind}>
				<Select.Trigger class="w-full sm:w-40">{kindLabel}</Select.Trigger>
				<Select.Content>
					{#each kindOptions as o (o.value)}
						<Select.Item value={o.value} label={o.label}>{o.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			<Select.Root type="single" bind:value={status}>
				<Select.Trigger class="w-full sm:w-40">{statusLabel}</Select.Trigger>
				<Select.Content>
					{#each statusOptions as o (o.value)}
						<Select.Item value={o.value} label={o.label}>{o.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			{#if hasFilters}
				<Button variant="ghost" size="sm" onclick={reset} class="shrink-0">
					<X class="size-4" /> Clear
				</Button>
			{/if}
		</div>

		<div class="flex items-center justify-between text-xs text-muted-foreground">
			<span>
				Showing <span class="font-medium text-foreground tabular-nums">{filtered.length}</span>
				of {data.entries.length} events
			</span>
		</div>

		<div class="overflow-hidden rounded-xl border">
			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row class="hover:bg-transparent">
							<Table.Head class="bg-muted/40">Time</Table.Head>
							<Table.Head class="bg-muted/40">Action</Table.Head>
							<Table.Head class="bg-muted/40">Status</Table.Head>
							<Table.Head class="bg-muted/40">Service</Table.Head>
							<Table.Head class="bg-muted/40">Model</Table.Head>
							<Table.Head class="bg-muted/40 text-right">Cost</Table.Head>
							<Table.Head class="bg-muted/40 text-right">Provider cache</Table.Head>
							<Table.Head class="bg-muted/40 text-right">Latency</Table.Head>
							<Table.Head class="bg-muted/40">Detail</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each filtered as e (e.id)}
							{@const tone = eventTone(e.status)}
							{@const Icon = actionIcon(e.action)}
							<Table.Row>
								<Table.Cell class="whitespace-nowrap text-muted-foreground">
									<span class="text-xs" title={formatDateTime(e.createdAt)}>
										{relativeTime(e.createdAt)}
									</span>
								</Table.Cell>
								<Table.Cell>
									<span class="flex items-center gap-2">
										<Icon class="size-3.5 shrink-0 text-muted-foreground" />
										<span class="font-mono text-xs font-medium">{e.action}</span>
									</span>
								</Table.Cell>
								<Table.Cell>
									<span class="flex items-center gap-1.5 whitespace-nowrap">
										<span class="size-1.5 rounded-full {toneDot[tone]}" aria-hidden="true"></span>
										<span class="text-xs font-medium {toneText[tone]}">
											{e.status}{e.statusCode ? ` ${e.statusCode}` : ''}
										</span>
									</span>
								</Table.Cell>
								<Table.Cell class="text-muted-foreground">{e.serviceName ?? '—'}</Table.Cell>
								<Table.Cell class="text-muted-foreground">{e.model ?? '—'}</Table.Cell>
								<Table.Cell class="text-right text-muted-foreground tabular-nums">
									{e.costUsd ? formatUsd(e.costUsd) : '—'}
								</Table.Cell>
								<Table.Cell class="text-right text-muted-foreground tabular-nums">
									{e.providerCachedTokens ? `${e.providerCachedTokens.toLocaleString()} tok` : '—'}
								</Table.Cell>
								<Table.Cell class="text-right text-muted-foreground tabular-nums">
									{e.latencyMs != null ? `${e.latencyMs}ms` : '—'}
								</Table.Cell>
								<Table.Cell class="max-w-[240px] truncate text-xs text-muted-foreground">
									{e.detail ?? ''}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>

			{#if filtered.length === 0}
				<div class="flex flex-col items-center justify-center py-16">
					<Search class="size-7 text-muted-foreground" />
					<p class="mt-3 text-sm font-medium">No matching events</p>
					<p class="text-sm text-muted-foreground">Try adjusting your search or filters.</p>
					<Button variant="outline" size="sm" onclick={reset} class="mt-4">Clear filters</Button>
				</div>
			{/if}
		</div>
	{/if}
</div>
