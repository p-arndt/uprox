<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import CheckboxGroup from '$lib/components/checkbox-group.svelte';
	import FieldHint from '$lib/components/field-hint.svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import type { InlineLimitValues } from '$lib/components/inline-limits';

	let {
		providers,
		values,
		idPrefix,
		scope,
		extraAdvancedActive = false,
		advanced
	}: {
		providers: { id: string; label: string }[];
		values: InlineLimitValues;
		/** prefixes field ids so multiple forms don't collide in the DOM */
		idPrefix: string;
		/**
		 * 'policy' is the reusable base layer (concrete values, no inherit);
		 * 'token'/'service' attach a preset and only narrow / override it inline.
		 */
		scope: 'token' | 'service' | 'policy';
		/** the parent's advanced extras (scopes, upstream key…) carry a value, so
		 * the advanced section should start expanded */
		extraAdvancedActive?: boolean;
		/** parent-supplied fields rendered at the top of the advanced section */
		advanced?: Snippet;
	} = $props();

	const id = (field: string) => `${idPrefix}-${field}`;
	const isPolicy = untrack(() => scope === 'policy');
	// Token/service limits fall through ("inherit") when blank; a policy is the
	// base layer so its hard limits are concrete numbers with no inherit state.
	const limitPlaceholder = isPolicy ? undefined : 'inherit';

	// Progressive disclosure: limits (the common override) are always visible;
	// access narrowing, caching and tracing live under "Advanced". We keep the
	// advanced fields mounted (toggling visibility, not the DOM) so they always
	// submit — bits-ui Collapsible would unmount them and silently drop values.
	const advancedActive = untrack(
		() =>
			extraAdvancedActive ||
			values.allowedProviders.length > 0 ||
			values.allowedModels !== '' ||
			values.preferredProvider !== '' ||
			values.cacheTtlSeconds !== '' ||
			values.tracingEnabled !== ''
	);
	let advancedOpen = $state(advancedActive);

	// OpenAI and Azure share the "gpt-*"/o-series namespace; pick which serves it.
	const sharedNamespaceProviders = $derived(
		providers.filter((p) => p.id === 'openai' || p.id === 'azure')
	);
	let preferred = $state(untrack(() => values.preferredProvider));
	const noPreferenceLabel = isPolicy ? 'No preference' : 'Inherit';
	const preferredLabel = (v: string) =>
		v ? (sharedNamespaceProviders.find((p) => p.id === v)?.label ?? v) : noPreferenceLabel;

	let tracing = $state(untrack(() => values.tracingEnabled));
	const tracingInherit = isPolicy ? 'Inherit org default' : 'Inherit';
	const tracingOptions = [
		{ value: '', label: tracingInherit },
		{ value: 'true', label: 'Always on' },
		{ value: 'false', label: 'Always off' }
	];
	const tracingLabel = (v: string) =>
		tracingOptions.find((o) => o.value === v)?.label ?? tracingInherit;

	// Help moved into hover hints to keep the form scannable; one short string each.
	const help = $derived({
		providers: isPolicy
			? 'None checked = all providers allowed.'
			: 'None checked = inherits. Only narrows — never widens the preset.',
		models: isPolicy
			? 'Comma-separated, trailing * matches a prefix. Blank = all models.'
			: 'Comma-separated, trailing * matches a prefix. Blank = inherits.',
		preferred:
			'When both OpenAI and Azure are set, which one serves shared models (gpt-*, o-series).',
		rate: isPolicy ? '0 = unlimited.' : 'Blank = inherit, 0 = unlimited.',
		budget:
			(isPolicy
				? 'Spend ceiling for whatever inherits this preset.'
				: scope === 'token'
					? "This token's spend cap, on top of the service ceiling."
					: 'Aggregate ceiling across all of this service’s tokens.') +
			(isPolicy ? ' 0 = unlimited. UTC windows.' : ' Blank = inherit, 0 = unlimited. UTC windows.'),
		cache: isPolicy
			? 'Overrides the org default. Blank = inherit, 0 = off, >0 = TTL.'
			: 'Blank = inherit, 0 = force off, >0 = TTL.',
		tracing: isPolicy
			? 'Overrides the org default. Capturing payloads stores prompt & response content.'
			: 'Capturing payloads stores prompt & response content. Blank = inherit.'
	});
</script>

<!-- Limits — the common override, always visible -->
<div class="space-y-4">
	<div class="space-y-2">
		<div class="flex items-center gap-1.5">
			<Label for={id('rateLimitPerMinute')}>Rate limit (req/min)</Label>
			<FieldHint text={help.rate} />
		</div>
		<Input
			id={id('rateLimitPerMinute')}
			name="rateLimitPerMinute"
			type="number"
			min="0"
			placeholder={limitPlaceholder}
			value={values.rateLimitPerMinute}
		/>
	</div>
	<div class="space-y-2">
		<div class="flex items-center gap-1.5">
			<Label>Budget (USD)</Label>
			<FieldHint text={help.budget} />
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div class="space-y-1">
				<Label for={id('dailyBudgetUsd')} class="text-xs font-normal text-muted-foreground">
					Daily
				</Label>
				<Input
					id={id('dailyBudgetUsd')}
					name="dailyBudgetUsd"
					type="number"
					min="0"
					step="0.01"
					placeholder={limitPlaceholder}
					value={values.dailyBudgetUsd}
				/>
			</div>
			<div class="space-y-1">
				<Label for={id('monthlyBudgetUsd')} class="text-xs font-normal text-muted-foreground">
					Monthly
				</Label>
				<Input
					id={id('monthlyBudgetUsd')}
					name="monthlyBudgetUsd"
					type="number"
					min="0"
					step="0.01"
					placeholder={limitPlaceholder}
					value={values.monthlyBudgetUsd}
				/>
			</div>
		</div>
	</div>
</div>

<!-- Advanced — access narrowing, caching, tracing (and any parent extras) -->
<div class="space-y-4">
	<Separator />
	<button
		type="button"
		class="flex w-full items-center justify-between text-sm font-medium text-foreground"
		aria-expanded={advancedOpen}
		onclick={() => (advancedOpen = !advancedOpen)}
	>
		<span class="flex items-center gap-2">
			Advanced settings
			{#if advancedActive}
				<span class="size-1.5 rounded-full bg-primary" title="Has custom values"></span>
			{/if}
		</span>
		<ChevronDown
			class="size-4 text-muted-foreground transition-transform duration-200 {advancedOpen
				? 'rotate-180'
				: ''}"
		/>
	</button>

	<div class="space-y-5" class:hidden={!advancedOpen}>
		{@render advanced?.()}

		<Separator />

		<div class="space-y-4">
			<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Access</p>
			<div class="space-y-2">
				<div class="flex items-center gap-1.5">
					<Label>Allowed providers</Label>
					<FieldHint text={help.providers} />
				</div>
				<CheckboxGroup
					name="allowedProviders"
					idPrefix={id('prov')}
					options={providers.map((p) => ({ value: p.id, label: p.label }))}
					selected={values.allowedProviders}
				/>
			</div>

			<div class="space-y-2">
				<div class="flex items-center gap-1.5">
					<Label for={id('allowedModels')}>Allowed models</Label>
					<FieldHint text={help.models} />
				</div>
				<Input
					id={id('allowedModels')}
					name="allowedModels"
					placeholder="gpt-4o*, claude-sonnet-4-6"
					value={values.allowedModels}
				/>
			</div>

			<div class="space-y-2">
				<div class="flex items-center gap-1.5">
					<Label for={id('preferredProvider')}>Preferred OpenAI backend</Label>
					<FieldHint text={help.preferred} />
				</div>
				<Select.Root type="single" name="preferredProvider" bind:value={preferred}>
					<Select.Trigger id={id('preferredProvider')} class="w-full">
						{preferredLabel(preferred)}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="" label={noPreferenceLabel}>{noPreferenceLabel}</Select.Item>
						{#each sharedNamespaceProviders as p (p.id)}
							<Select.Item value={p.id} label={p.label}>{p.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		</div>

		<Separator />

		<div class="space-y-4">
			<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
				Caching & tracing
			</p>
			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-2">
					<div class="flex items-center gap-1.5">
						<Label for={id('cacheTtlSeconds')}>Cache TTL (s)</Label>
						<FieldHint text={help.cache} />
					</div>
					<Input
						id={id('cacheTtlSeconds')}
						name="cacheTtlSeconds"
						type="number"
						min="0"
						placeholder={limitPlaceholder}
						value={values.cacheTtlSeconds}
					/>
				</div>
				<div class="space-y-2">
					<div class="flex items-center gap-1.5">
						<Label for={id('tracingEnabled')}>Request tracing</Label>
						<FieldHint text={help.tracing} />
					</div>
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
				</div>
			</div>
		</div>
	</div>
</div>
