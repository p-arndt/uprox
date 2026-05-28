<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';

	export interface PolicyFormValues {
		id?: string;
		name: string;
		allowedProviders: string[];
		/** comma-joined model patterns */
		allowedModels: string;
		preferredProvider: string;
		rateLimitPerMinute: number | string;
		dailyBudgetUsd: number | string;
		monthlyBudgetUsd: number | string;
		/** '' = inherit org default */
		cacheTtlSeconds: string;
	}

	let {
		providers,
		action,
		submitLabel,
		values,
		idPrefix,
		resetOnSuccess = false
	}: {
		providers: { id: string; label: string }[];
		action: string;
		submitLabel: string;
		values: PolicyFormValues;
		/** prefixes field ids so create & edit forms don't collide in the DOM */
		idPrefix: string;
		resetOnSuccess?: boolean;
	} = $props();

	// Tabs unmount inactive content in bits-ui, which would drop fields from the
	// submitted form — so we drive the panels ourselves and only toggle visibility,
	// keeping every input mounted regardless of the active tab.
	let tab = $state('access');

	// OpenAI and Azure share the "gpt-*"/o-series namespace; a policy can pin which
	// one serves it. Other providers (e.g. Anthropic) route unambiguously by name.
	const sharedNamespaceProviders = $derived(
		providers.filter((p) => p.id === 'openai' || p.id === 'azure')
	);
	// seeded once from the prop; the edit dialog remounts this form per policy
	// (keyed on id), so re-seeding happens naturally on mount
	let preferred = $state(untrack(() => values.preferredProvider));
	const preferredLabel = (id: string) =>
		id ? (sharedNamespaceProviders.find((p) => p.id === id)?.label ?? id) : 'No preference';

	const id = (field: string) => `${idPrefix}-${field}`;
</script>

<form
	method="post"
	{action}
	class="space-y-4"
	use:enhance={() =>
		async ({ update }) =>
			update({ reset: resetOnSuccess })}
>
	{#if values.id}
		<input type="hidden" name="id" value={values.id} />
	{/if}

	<div class="space-y-2">
		<Label for={id('name')}>Name</Label>
		<Input
			id={id('name')}
			name="name"
			placeholder="read-only-openai"
			value={values.name}
			required
		/>
	</div>

	<Tabs.Root bind:value={tab}>
		<Tabs.List class="grid w-full grid-cols-3">
			<Tabs.Trigger value="access">Access</Tabs.Trigger>
			<Tabs.Trigger value="limits">Limits</Tabs.Trigger>
			<Tabs.Trigger value="caching">Caching</Tabs.Trigger>
		</Tabs.List>
	</Tabs.Root>

	<!-- Access -->
	<div class="space-y-4" class:hidden={tab !== 'access'}>
		<div class="space-y-2">
			<Label>Allowed providers</Label>
			<div class="flex flex-wrap gap-4">
				{#each providers as p (p.id)}
					<label class="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							name="allowedProviders"
							value={p.id}
							checked={values.allowedProviders.includes(p.id)}
							class="size-4 accent-foreground"
						/>
						{p.label}
					</label>
				{/each}
			</div>
			<p class="text-xs text-muted-foreground">None checked = all providers allowed.</p>
		</div>

		<div class="space-y-2">
			<Label for={id('allowedModels')}>Allowed models</Label>
			<Input
				id={id('allowedModels')}
				name="allowedModels"
				placeholder="gpt-4o*, claude-3-5-sonnet"
				value={values.allowedModels}
			/>
			<p class="text-xs text-muted-foreground">
				Comma-separated. Trailing <code>*</code> matches a prefix. Blank = all models.
			</p>
		</div>

		<div class="space-y-2">
			<Label for={id('preferredProvider')}>Preferred OpenAI backend</Label>
			<Select.Root type="single" name="preferredProvider" bind:value={preferred}>
				<Select.Trigger id={id('preferredProvider')} class="w-full">
					{preferredLabel(preferred)}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="" label="No preference">No preference</Select.Item>
					{#each sharedNamespaceProviders as p (p.id)}
						<Select.Item value={p.id} label={p.label}>{p.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			<p class="text-xs text-muted-foreground">
				When both OpenAI and Azure are configured, which one serves shared models (<code>gpt-*</code
				>, o-series). With only one configured, that one is used.
			</p>
		</div>
	</div>

	<!-- Limits -->
	<div class="space-y-4" class:hidden={tab !== 'limits'}>
		<div class="space-y-2">
			<Label for={id('rateLimitPerMinute')}>Rate limit (req/min)</Label>
			<Input
				id={id('rateLimitPerMinute')}
				name="rateLimitPerMinute"
				type="number"
				min="0"
				value={values.rateLimitPerMinute}
			/>
			<p class="text-xs text-muted-foreground">0 = unlimited.</p>
		</div>
		<div class="grid grid-cols-2 gap-4">
			<div class="space-y-2">
				<Label for={id('dailyBudgetUsd')}>Daily budget (USD)</Label>
				<Input
					id={id('dailyBudgetUsd')}
					name="dailyBudgetUsd"
					type="number"
					min="0"
					step="0.01"
					value={values.dailyBudgetUsd}
				/>
			</div>
			<div class="space-y-2">
				<Label for={id('monthlyBudgetUsd')}>Monthly budget (USD)</Label>
				<Input
					id={id('monthlyBudgetUsd')}
					name="monthlyBudgetUsd"
					type="number"
					min="0"
					step="0.01"
					value={values.monthlyBudgetUsd}
				/>
			</div>
		</div>
		<p class="text-xs text-muted-foreground">
			Per-service spend ceilings (UTC windows). 0 = unlimited. Crossing the org's alert threshold
			can email admins — see Settings.
		</p>
	</div>

	<!-- Caching -->
	<div class="space-y-4" class:hidden={tab !== 'caching'}>
		<div class="space-y-2">
			<Label for={id('cacheTtlSeconds')}>Cache TTL (seconds)</Label>
			<Input
				id={id('cacheTtlSeconds')}
				name="cacheTtlSeconds"
				type="number"
				min="0"
				placeholder="inherit org default"
				value={values.cacheTtlSeconds}
			/>
			<p class="text-xs text-muted-foreground">
				Overrides the org-wide cache setting. Blank = inherit, 0 = force off, &gt;0 = TTL.
			</p>
		</div>
	</div>

	<Dialog.Footer>
		<Button type="submit">{submitLabel}</Button>
	</Dialog.Footer>
</form>
