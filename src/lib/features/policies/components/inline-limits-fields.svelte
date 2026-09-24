<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import CheckboxGroup from '$lib/components/form/checkbox-group.svelte';
	import DisclosureSection from '$lib/components/form/disclosure-section.svelte';
	import FieldLabel from '$lib/components/form/field-label.svelte';
	import SelectField from '$lib/components/form/select-field.svelte';
	import type { InlineLimitValues } from '$lib/features/policies/inline-limits';
	import type { InheritedLimits } from '$lib/features/policies/effective-config-view';
	import {
		inheritedText,
		inlineLimitHelp,
		inlineLimitHints,
		type InlineLimitScope
	} from '$lib/features/policies/inline-limits-hints';

	let {
		providers,
		values,
		idPrefix,
		scope,
		inherited,
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
	// Token/service limits fall through ("inherit") when blank; a policy is the
	// base layer so its hard limits are concrete numbers with no inherit state.
	const providerLabel = (pid: string) => providers.find((p) => p.id === pid)?.label ?? pid;
	const blank = $derived(isPolicy ? undefined : inheritedText(inherited, providerLabel));
	// Details stay in hover hints to keep the form scannable; only the semantics
	// people get wrong (per-token rate vs shared budget, 0 = unlimited) are visible.
	const help = $derived(inlineLimitHints(scope));
	const visibleHelp = $derived(inlineLimitHelp(scope));

	// Sections holding custom values start expanded; the rest collapse to keep
	// the form short. A policy IS its limits (and its numbers default to "0"),
	// so every section opens and no summary is shown.
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
	const summary = (active: boolean, inheritedSummary: string | undefined) =>
		isPolicy ? undefined : active ? 'Custom' : inheritedSummary;

	// OpenAI and Azure share the "gpt-*"/o-series namespace; pick which serves it.
	const preferredOptions = $derived([
		{ value: '', label: blank?.preferred ?? 'No preference' },
		...providers
			.filter((p) => p.id === 'openai' || p.id === 'azure')
			.map((p) => ({ value: p.id, label: p.label }))
	]);
	let preferred = $state(untrack(() => values.preferredProvider));
</script>

<div class="space-y-4">
	<DisclosureSection
		title="Limits"
		summary={summary(limitsActive, blank?.limitsSummary)}
		active={!isPolicy && limitsActive}
		open={isPolicy || limitsActive}
	>
		{@render limitsExtra?.()}
		<div class="space-y-2">
			<FieldLabel for={id('rateLimitPerMinute')} label="Rate limit (req/min)" hint={help.rate} />
			<Input
				id={id('rateLimitPerMinute')}
				name="rateLimitPerMinute"
				type="number"
				min="0"
				placeholder={blank?.rate}
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
						placeholder={blank?.daily}
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
						placeholder={blank?.monthly}
						value={values.monthlyBudgetUsd}
					/>
				</div>
			</div>
			<p class="text-xs text-muted-foreground">{visibleHelp.budget}</p>
		</div>
	</DisclosureSection>

	<Separator />

	<DisclosureSection
		title="Access"
		summary={summary(accessActive, blank?.accessSummary)}
		active={!isPolicy && accessActive}
		open={isPolicy || accessActive}
	>
		{@render accessExtra?.()}
		<div class="space-y-2">
			<FieldLabel label="Allowed providers" hint={help.providers} />
			<CheckboxGroup
				name="allowedProviders"
				idPrefix={id('prov')}
				options={providers.map((p) => ({ value: p.id, label: p.label }))}
				selected={values.allowedProviders}
			/>
			{#if blank?.providers}
				<p class="text-xs text-muted-foreground">{blank.providers}</p>
			{/if}
		</div>

		<div class="space-y-2">
			<FieldLabel for={id('allowedModels')} label="Allowed models" hint={help.models} />
			<Input
				id={id('allowedModels')}
				name="allowedModels"
				placeholder={blank?.models ?? 'gpt-4o*, claude-sonnet-4-6'}
				value={values.allowedModels}
			/>
		</div>

		<div class="space-y-2">
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
		</div>
	</DisclosureSection>

	<Separator />

	<DisclosureSection
		title="Advanced"
		summary={summary(advancedActive, blank?.advancedSummary)}
		active={!isPolicy && advancedActive}
		open={isPolicy || advancedActive}
	>
		{@render advanced?.()}
		<div class="grid grid-cols-2 gap-3">
			<div class="space-y-2">
				<FieldLabel for={id('cacheTtlSeconds')} label="Cache TTL (s)" hint={help.cache} />
				<Input
					id={id('cacheTtlSeconds')}
					name="cacheTtlSeconds"
					type="number"
					min="0"
					placeholder={blank?.cache}
					value={values.cacheTtlSeconds}
				/>
				<p class="text-xs text-muted-foreground">{visibleHelp.cache}</p>
			</div>
		</div>
	</DisclosureSection>
</div>
