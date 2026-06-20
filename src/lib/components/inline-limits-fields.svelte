<script lang="ts">
	import { untrack } from 'svelte';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import type { InlineLimitValues } from '$lib/components/inline-limits';

	let {
		providers,
		values,
		idPrefix,
		scope
	}: {
		providers: { id: string; label: string }[];
		values: InlineLimitValues;
		/** prefixes field ids so multiple forms don't collide in the DOM */
		idPrefix: string;
		/** tunes the budget help text: a token's personal cap vs a service ceiling */
		scope: 'token' | 'service';
	} = $props();

	const id = (field: string) => `${idPrefix}-${field}`;

	// Tabs unmount inactive content in bits-ui, which would drop fields from the
	// submitted form — so we drive the panels ourselves and only toggle visibility,
	// keeping every input mounted regardless of the active tab.
	let tab = $state('access');

	// OpenAI and Azure share the "gpt-*"/o-series namespace; pick which serves it.
	const sharedNamespaceProviders = $derived(
		providers.filter((p) => p.id === 'openai' || p.id === 'azure')
	);
	let preferred = $state(untrack(() => values.preferredProvider));
	const preferredLabel = (v: string) =>
		v ? (sharedNamespaceProviders.find((p) => p.id === v)?.label ?? v) : 'Inherit';

	let tracing = $state(untrack(() => values.tracingEnabled));
	const tracingOptions = [
		{ value: '', label: 'Inherit' },
		{ value: 'true', label: 'Always on' },
		{ value: 'false', label: 'Always off' }
	];
	const tracingLabel = (v: string) => tracingOptions.find((o) => o.value === v)?.label ?? 'Inherit';

	const budgetHint = $derived(
		scope === 'token'
			? "This token's personal spend cap. Enforced on top of the service's ceiling."
			: 'Aggregate ceiling across all of this service’s tokens.'
	);
</script>

<Tabs.Root bind:value={tab}>
	<Tabs.List class="grid w-full grid-cols-4">
		<Tabs.Trigger value="access">Access</Tabs.Trigger>
		<Tabs.Trigger value="limits">Limits</Tabs.Trigger>
		<Tabs.Trigger value="caching">Caching</Tabs.Trigger>
		<Tabs.Trigger value="tracing">Tracing</Tabs.Trigger>
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
		<p class="text-xs text-muted-foreground">
			None checked = no extra limit (inherits). Only narrows further — never widens what the preset
			or service already allows.
		</p>
	</div>

	<div class="space-y-2">
		<Label for={id('allowedModels')}>Allowed models</Label>
		<Input
			id={id('allowedModels')}
			name="allowedModels"
			placeholder="gpt-4o*, claude-sonnet-4-6"
			value={values.allowedModels}
		/>
		<p class="text-xs text-muted-foreground">
			Comma-separated. Trailing <code>*</code> matches a prefix. Blank = no extra limit. Only narrows
			further.
		</p>
	</div>

	<div class="space-y-2">
		<Label for={id('preferredProvider')}>Preferred OpenAI backend</Label>
		<Select.Root type="single" name="preferredProvider" bind:value={preferred}>
			<Select.Trigger id={id('preferredProvider')} class="w-full">
				{preferredLabel(preferred)}
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="" label="Inherit">Inherit</Select.Item>
				{#each sharedNamespaceProviders as p (p.id)}
					<Select.Item value={p.id} label={p.label}>{p.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		<p class="text-xs text-muted-foreground">
			When both OpenAI and Azure are configured, which one serves shared models. Blank = inherit.
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
			placeholder="inherit"
			value={values.rateLimitPerMinute}
		/>
		<p class="text-xs text-muted-foreground">Blank = inherit, 0 = unlimited.</p>
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
				placeholder="inherit"
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
				placeholder="inherit"
				value={values.monthlyBudgetUsd}
			/>
		</div>
	</div>
	<p class="text-xs text-muted-foreground">
		{budgetHint} Blank = inherit, 0 = unlimited. UTC windows.
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
			placeholder="inherit"
			value={values.cacheTtlSeconds}
		/>
		<p class="text-xs text-muted-foreground">Blank = inherit, 0 = force off, &gt;0 = TTL.</p>
	</div>
</div>

<!-- Tracing -->
<div class="space-y-4" class:hidden={tab !== 'tracing'}>
	<div class="space-y-2">
		<Label for={id('tracingEnabled')}>Request tracing</Label>
		<Select.Root type="single" name="tracingEnabled" bind:value={tracing}>
			<Select.Trigger id={id('tracingEnabled')} class="w-full">
				{tracingLabel(tracing)}
			</Select.Trigger>
			<Select.Content>
				{#each tracingOptions as o (o.value)}
					<Select.Item value={o.value} label={o.label}>{o.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		<p class="text-xs text-muted-foreground">
			Capturing payloads stores prompt &amp; response content. Blank = inherit.
		</p>
	</div>
</div>
