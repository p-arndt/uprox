<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { Checkbox as CheckboxPrimitive } from 'bits-ui';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import DisclosureSection from '$lib/components/form/disclosure-section.svelte';
	import FieldLabel from '$lib/components/form/field-label.svelte';
	import SelectField from '$lib/components/form/select-field.svelte';
	import ModelPatternInput from '$lib/features/policies/components/model-pattern-input.svelte';
	import type { InlineLimitValues } from '$lib/features/policies/inline-limits';
	import type { InheritedLimits } from '$lib/features/policies/effective-config-view';
	import {
		inheritedText,
		inlineLimitHelp,
		inlineLimitHints,
		preferredBackendRelevant,
		type InlineLimitScope
	} from '$lib/features/policies/inline-limits-hints';

	let {
		providers,
		values,
		idPrefix,
		scope,
		inherited,
		modelSuggestions = [],
		limitsExtra,
		accessExtra,
		advanced,
		extraLimitsActive = false,
		extraAccessActive = false,
		extraAdvancedActive = false
	}: {
		providers: { id: string; label: string }[];
		values: InlineLimitValues;
		/** prefixes field ids so multiple forms don't collide in the DOM */
		idPrefix: string;
		/**
		 * 'policy' is the reusable base layer (concrete values, no inherit);
		 * 'token'/'service' attach a preset and only narrow / override it inline.
		 */
		scope: InlineLimitScope;
		/**
		 * What each field falls back to when left blank (token/service only), e.g.
		 * toInheritedLimits(explainInherited(...)). Omitted = a bare "inherit".
		 */
		inherited?: InheritedLimits;
		/**
		 * Known model ids (e.g. knownModelIds() from $lib/server/policies), offered
		 * while typing a model pattern and used to flag likely typos. Optional.
		 */
		modelSuggestions?: string[];
		/** parent-supplied fields rendered at the top of the Limits section */
		limitsExtra?: Snippet;
		/** parent-supplied fields rendered at the top of the Access section */
		accessExtra?: Snippet;
		/** parent-supplied fields rendered at the top of the Advanced section */
		advanced?: Snippet;
		/** a parent extra in that section carries a value, so it counts as active */
		extraLimitsActive?: boolean;
		extraAccessActive?: boolean;
		extraAdvancedActive?: boolean;
	} = $props();

	const id = (field: string) => `${idPrefix}-${field}`;
	const isPolicy = untrack(() => scope === 'policy');
	// Token/service fields fall through ("inherit") when blank. A preset is the
	// base layer: its blank rate/budgets are stored as 0 (unlimited) while a
	// blank cache TTL keeps the instance default, so the placeholders say so.
	const providerLabel = (pid: string) => providers.find((p) => p.id === pid)?.label ?? pid;
	const blank = $derived(isPolicy ? undefined : inheritedText(inherited, providerLabel));
	const placeholders = $derived({
		rate: blank?.rate ?? '0 = unlimited',
		daily: blank?.daily ?? '0 = unlimited',
		monthly: blank?.monthly ?? '0 = unlimited',
		cache: blank?.cache ?? 'instance default'
	});
	// Details stay in hover hints to keep the form scannable; the semantics
	// people get wrong (per-token rate vs shared budget, 0 = unlimited, lists
	// narrow) are visible text.
	const help = $derived(inlineLimitHints(scope));
	const visibleHelp = $derived(inlineLimitHelp(scope));

	// Sections holding custom values start expanded; the rest collapse to keep
	// the form short. A preset IS its limits, so it gets plain headings instead.
	const limitsActive = untrack(
		() =>
			extraLimitsActive ||
			values.rateLimitPerMinute !== '' ||
			values.dailyBudgetUsd !== '' ||
			values.monthlyBudgetUsd !== ''
	);
	const accessActive = untrack(
		() =>
			extraAccessActive ||
			values.allowedProviders.length > 0 ||
			values.allowedModels !== '' ||
			values.preferredProvider !== ''
	);
	const advancedActive = untrack(() => extraAdvancedActive || values.cacheTtlSeconds !== '');

	// Owned here (not via CheckboxGroup) so the preferred-backend field can
	// react to which providers are checked.
	let checkedProviders = $state(untrack(() => [...values.allowedProviders]));
	const backendRelevant = $derived(
		preferredBackendRelevant(checkedProviders, inherited?.allowedProviders)
	);

	// OpenAI and Azure share the "gpt-*"/o-series namespace; pick which serves it.
	const preferredOptions = $derived([
		{ value: '', label: blank?.preferred ?? 'No preference' },
		...providers
			.filter((p) => p.id === 'openai' || p.id === 'azure')
			.map((p) => ({ value: p.id, label: p.label }))
	]);
	let preferred = $state(untrack(() => values.preferredProvider));
</script>

{#snippet section(title: string, summary: string | undefined, active: boolean, body: Snippet)}
	{#if isPolicy}
		<section class="space-y-4">
			<h3 class="text-sm font-medium">{title}</h3>
			{@render body()}
		</section>
	{:else}
		<DisclosureSection {title} summary={active ? 'Custom' : summary} {active} open={active}>
			{@render body()}
		</DisclosureSection>
	{/if}
{/snippet}

{#snippet limitsBody()}
	{@render limitsExtra?.()}
	<div class="space-y-2">
		<FieldLabel for={id('rateLimitPerMinute')} label="Rate limit (req/min)" hint={help.rate} />
		<Input
			id={id('rateLimitPerMinute')}
			name="rateLimitPerMinute"
			type="number"
			min="0"
			step="1"
			placeholder={placeholders.rate}
			value={values.rateLimitPerMinute}
		/>
		<p class="text-xs text-muted-foreground">{visibleHelp.rate}</p>
	</div>
	<div class="space-y-2">
		<FieldLabel label="Budget (USD)" hint={help.budget} />
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
					placeholder={placeholders.daily}
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
					placeholder={placeholders.monthly}
					value={values.monthlyBudgetUsd}
				/>
			</div>
		</div>
		<p class="text-xs text-muted-foreground">{visibleHelp.budget}</p>
	</div>
{/snippet}

{#snippet accessBody()}
	<p class="text-xs text-muted-foreground">{visibleHelp.cascade}</p>
	{@render accessExtra?.()}
	<div class="space-y-2">
		<FieldLabel label="Allowed providers" hint={help.providers} />
		<CheckboxPrimitive.Group
			name="allowedProviders"
			bind:value={checkedProviders}
			class="flex flex-wrap gap-x-5 gap-y-2.5"
		>
			{#each providers as p (p.id)}
				<div class="flex items-center gap-2">
					<Checkbox id={id(`prov-${p.id}`)} value={p.id} />
					<Label for={id(`prov-${p.id}`)} class="font-normal">{p.label}</Label>
				</div>
			{/each}
		</CheckboxPrimitive.Group>
		<p class="text-xs text-muted-foreground">{visibleHelp.providers}</p>
		{#if blank?.providers}
			<p class="text-xs text-muted-foreground">{blank.providers}</p>
		{/if}
	</div>

	<div class="space-y-2">
		<FieldLabel for={id('allowedModels')} label="Allowed models" hint={help.models} />
		<ModelPatternInput
			id={id('allowedModels')}
			name="allowedModels"
			value={values.allowedModels}
			suggestions={modelSuggestions}
			placeholder={blank?.models ?? 'gpt-4o*, claude-sonnet-4-6'}
		/>
		<p class="text-xs text-muted-foreground">{visibleHelp.models}</p>
	</div>

	<div class="space-y-2">
		{#if backendRelevant}
			<FieldLabel
				for={id('preferredProvider')}
				label="Preferred OpenAI backend"
				hint={help.preferred}
			/>
			<SelectField
				id={id('preferredProvider')}
				name="preferredProvider"
				bind:value={preferred}
				options={preferredOptions}
			/>
		{:else}
			<!-- keep the stored choice; it takes effect again once both are allowed -->
			<input type="hidden" name="preferredProvider" value={preferred} />
			<p class="text-xs text-muted-foreground">
				Preferred OpenAI backend: not needed, it only matters when both OpenAI and Azure OpenAI are
				allowed.
			</p>
		{/if}
	</div>
{/snippet}

{#snippet advancedBody()}
	{@render advanced?.()}
	<div class="grid grid-cols-2 gap-3">
		<div class="space-y-2">
			<FieldLabel for={id('cacheTtlSeconds')} label="Cache TTL (s)" hint={help.cache} />
			<Input
				id={id('cacheTtlSeconds')}
				name="cacheTtlSeconds"
				type="number"
				min="0"
				step="1"
				placeholder={placeholders.cache}
				value={values.cacheTtlSeconds}
			/>
		</div>
	</div>
	<p class="text-xs text-muted-foreground">{visibleHelp.cache}</p>
{/snippet}

<div class="space-y-4">
	{@render section('Limits', blank?.limitsSummary, !isPolicy && limitsActive, limitsBody)}
	<Separator />
	{@render section('Access', blank?.accessSummary, !isPolicy && accessActive, accessBody)}
	<Separator />
	{@render section(
		isPolicy ? 'Cache' : 'Advanced',
		blank?.advancedSummary,
		!isPolicy && advancedActive,
		advancedBody
	)}
</div>
