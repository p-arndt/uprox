<script lang="ts">
	import { untrack } from 'svelte';
	import { Checkbox as CheckboxPrimitive } from 'bits-ui';
	import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import {
		GATEWAY_SCOPES,
		SCOPE_BUNDLES,
		SCOPE_INFO,
		bundleForScopes,
		scopeSelectionError,
		scopesForBundle,
		type ScopeMode
	} from '$lib/scopes';

	let {
		selected,
		idPrefix
	}: {
		/** the token's current scopes; empty = all endpoints */
		selected: string[];
		/** namespaces the control ids so create & edit forms don't collide in the DOM */
		idPrefix: string;
	} = $props();

	// Seeded once — the dialogs remount the form per token, so re-seeding
	// happens naturally on mount.
	let mode = $state<ScopeMode>(untrack(() => (selected.length > 0 ? 'selected' : 'all')));
	let scopes = $state<string[]>(untrack(() => [...selected]));

	const id = (field: string) => `${idPrefix}-${field}`;
	const error = $derived(scopeSelectionError(mode, scopes));
	const activeBundle = $derived(mode === 'all' ? 'all' : bundleForScopes(scopes));
	const quickPicks = SCOPE_BUNDLES.filter((b) => b.id !== 'all');

	// The server reads an empty `scopes` list as "all endpoints", so the only way
	// to stop "Only selected" + nothing ticked from submitting as "all" is to
	// block the native submit with a custom validity on a focusable guard input.
	let guard = $state<HTMLInputElement>();
	$effect(() => {
		guard?.setCustomValidity(error ?? '');
	});

	function pickBundle(bundleScopes: string[]) {
		mode = 'selected';
		scopes = bundleScopes;
	}
</script>

<div class="space-y-3">
	<RadioGroup.Root
		bind:value={() => mode, (v) => (mode = v as ScopeMode)}
		class="grid-cols-2 gap-2"
		aria-label="Endpoint access"
	>
		{#each [{ value: 'all', label: 'All endpoints', hint: 'Including endpoints added later' }, { value: 'selected', label: 'Only selected', hint: 'Pick the endpoints below' }] as o (o.value)}
			<Label
				for={id(o.value)}
				class="flex cursor-pointer items-start gap-2.5 rounded-md border p-3 font-normal has-data-checked:border-primary has-data-checked:bg-accent/40"
			>
				<RadioGroup.Item id={id(o.value)} value={o.value} class="mt-0.5" />
				<span class="grid gap-0.5">
					<span class="font-medium">{o.label}</span>
					<span class="text-xs text-muted-foreground">{o.hint}</span>
				</span>
			</Label>
		{/each}
	</RadioGroup.Root>

	<div class="flex flex-wrap items-center gap-1.5">
		<span class="text-xs text-muted-foreground">Quick pick:</span>
		{#each quickPicks as b (b.id)}
			<Button
				type="button"
				size="xs"
				variant={activeBundle === b.id ? 'secondary' : 'outline'}
				aria-pressed={activeBundle === b.id}
				onclick={() => pickBundle(scopesForBundle(b.id))}
			>
				{b.label}
			</Button>
		{/each}
	</div>

	{#if mode === 'selected'}
		<CheckboxPrimitive.Group
			name="scopes"
			bind:value={scopes}
			class="grid gap-x-4 gap-y-2.5 sm:grid-cols-2"
		>
			{#each GATEWAY_SCOPES as s (s)}
				<div class="flex items-start gap-2">
					<Checkbox id={id(s)} value={s} class="mt-0.5" />
					<Label for={id(s)} class="grid gap-0.5 font-normal">
						<span>{SCOPE_INFO[s].label}</span>
						<span class="text-xs text-muted-foreground">{SCOPE_INFO[s].description}</span>
					</Label>
				</div>
			{/each}
		</CheckboxPrimitive.Group>
	{/if}

	{#if error}
		<input bind:this={guard} tabindex="-1" aria-hidden="true" class="sr-only" />
		<p class="text-sm text-destructive" role="alert">{error}</p>
	{/if}
</div>
