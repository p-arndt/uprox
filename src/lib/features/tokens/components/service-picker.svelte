<script lang="ts">
	import * as Popover from '$lib/components/ui/popover/index.js';
	import * as Command from '$lib/components/ui/command/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { formatDateTime } from '$lib/format';
	import { DEFAULT_SERVICE_NAME, servicePickerOptions } from '$lib/features/tokens/token-helpers';
	import Check from '@lucide/svelte/icons/check';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import Plus from '@lucide/svelte/icons/plus';

	// A searchable service select for the token form. A plain select can't cope
	// with dozens of services, and creating a service inline saves a detour
	// through the services page just to file one token.

	let {
		id,
		name,
		value = $bindable(''),
		services,
		canCreate = false
	}: {
		id?: string;
		name: string;
		value?: string;
		services: { id: string; name: string; createdAt?: Date | string }[];
		/** whether the user may create services (services:manage) */
		canCreate?: boolean;
	} = $props();

	let open = $state(false);
	let search = $state('');
	let creating = $state(false);
	// 'new' swaps the list for a name field, so creating doesn't depend on
	// discovering that typing into the search offers it
	let mode = $state<'pick' | 'new'>('pick');
	let newName = $state('');
	let error = $state('');
	// Created here but not yet in `services`: the page data refreshes only after
	// the token itself is saved, and reloading earlier would wipe the form.
	let created = $state<{ id: string; name: string; createdAt?: string }[]>([]);

	const options = $derived.by(() => {
		const all = servicePickerOptions([...services, ...created]);
		// '' makes the server file the token under Default, creating it on first use
		return all.some((o) => o.name === DEFAULT_SERVICE_NAME)
			? all
			: [{ id: '', name: DEFAULT_SERVICE_NAME, duplicate: false }, ...all];
	});
	const selectedLabel = $derived(options.find((o) => o.id === value)?.name ?? 'Default');
	const trimmed = $derived(search.trim());
	const canOfferCreate = $derived(
		canCreate &&
			trimmed !== '' &&
			!options.some((o) => o.name.toLowerCase() === trimmed.toLowerCase())
	);

	$effect(() => {
		if (!open) {
			mode = 'pick';
			error = '';
		}
	});

	async function createService(serviceName: string) {
		if (!serviceName.trim()) return;
		creating = true;
		error = '';
		try {
			const res = await fetch('/api/services', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: serviceName.trim() })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				error = body.message ?? body.error ?? 'Could not create the service';
				return;
			}
			created = [...created, { id: body.id, name: body.name, createdAt: body.createdAt }];
			value = body.id;
			search = '';
			newName = '';
			open = false;
		} finally {
			creating = false;
		}
	}
</script>

<input type="hidden" {name} {value} />

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				{id}
				variant="outline"
				role="combobox"
				aria-expanded={open}
				class="w-full justify-between font-normal"
			>
				<span class="truncate">{selectedLabel}</span>
				<ChevronsUpDown class="size-4 shrink-0 text-muted-foreground" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content align="start" class="w-(--bits-popover-anchor-width) min-w-64 p-0">
		{#if mode === 'new'}
			<div class="space-y-3 p-3">
				<p class="text-sm font-medium">New service</p>
				<Input
					bind:value={newName}
					placeholder="e.g. support-agent"
					autofocus
					onkeydown={(e) => {
						// Enter would otherwise submit the surrounding token form
						if (e.key === 'Enter') {
							e.preventDefault();
							createService(newName);
						}
					}}
				/>
				<p class="text-xs text-muted-foreground">
					Limits and a preset can be set later on the service page.
				</p>
				{#if error}
					<p class="text-xs text-destructive">{error}</p>
				{/if}
				<div class="flex justify-end gap-2">
					<Button type="button" variant="ghost" size="sm" onclick={() => (mode = 'pick')}>
						Back
					</Button>
					<Button
						type="button"
						size="sm"
						disabled={creating || !newName.trim()}
						onclick={() => createService(newName)}
					>
						Create
					</Button>
				</div>
			</div>
		{:else}
			<Command.Root>
				<Command.Input bind:value={search} placeholder="Search services…" />
				<Command.List class="max-h-64">
					<Command.Empty>No service found.</Command.Empty>
					{#each options as o (o.id)}
						<Command.Item
							value="{o.name} {o.id}"
							onSelect={() => {
								value = o.id;
								open = false;
							}}
						>
							<Check class="size-4 shrink-0 {o.id === value ? '' : 'invisible'}" />
							<span class="min-w-0 flex-1 truncate">{o.name}</span>
							{#if o.duplicate && o.createdAt}
								<span class="shrink-0 text-xs text-muted-foreground">
									created {formatDateTime(o.createdAt)}
								</span>
							{/if}
						</Command.Item>
					{/each}
				</Command.List>
				{#if canCreate}
					<!-- outside Command.List so the search filter never hides it -->
					<div class="border-t p-1">
						<button
							type="button"
							disabled={creating}
							onclick={() => {
								if (canOfferCreate) createService(trimmed);
								else {
									newName = '';
									mode = 'new';
								}
							}}
							class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
						>
							<Plus class="size-4" />
							{canOfferCreate ? `Create service “${trimmed}”` : 'New service…'}
						</button>
					</div>
				{/if}
				{#if error}
					<p class="border-t px-3 py-2 text-xs text-destructive">{error}</p>
				{/if}
			</Command.Root>
		{/if}
	</Popover.Content>
</Popover.Root>
