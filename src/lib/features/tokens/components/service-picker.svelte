<script lang="ts">
	import * as Popover from '$lib/components/ui/popover/index.js';
	import * as Command from '$lib/components/ui/command/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { formatDateTime } from '$lib/format';
	import { servicePickerOptions } from '$lib/features/tokens/token-helpers';
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
	let error = $state('');
	// Created here but not yet in `services`: the page data refreshes only after
	// the token itself is saved, and reloading earlier would wipe the form.
	let created = $state<{ id: string; name: string; createdAt?: string }[]>([]);

	const options = $derived(servicePickerOptions([...services, ...created]));
	const selectedLabel = $derived(options.find((o) => o.id === value)?.name ?? 'Default');
	const trimmed = $derived(search.trim());
	const canOfferCreate = $derived(
		canCreate &&
			trimmed !== '' &&
			!options.some((o) => o.name.toLowerCase() === trimmed.toLowerCase())
	);

	async function createService() {
		creating = true;
		error = '';
		try {
			const res = await fetch('/api/services', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: trimmed })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				error = body.message ?? body.error ?? 'Could not create the service';
				return;
			}
			created = [...created, { id: body.id, name: body.name, createdAt: body.createdAt }];
			value = body.id;
			search = '';
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
		<Command.Root>
			<Command.Input
				bind:value={search}
				placeholder={canCreate ? 'Search or create a service…' : 'Search services…'}
			/>
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
			{#if canOfferCreate}
				<div class="border-t p-1">
					<!-- outside Command.List so the fuzzy filter never hides it -->
					<button
						type="button"
						disabled={creating}
						onclick={createService}
						class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
					>
						<Plus class="size-4" />
						Create service “{trimmed}”
					</button>
				</div>
			{/if}
			{#if error}
				<p class="border-t px-3 py-2 text-xs text-destructive">{error}</p>
			{/if}
		</Command.Root>
	</Popover.Content>
</Popover.Root>
