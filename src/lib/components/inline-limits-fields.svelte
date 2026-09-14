<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import FieldLabel from '$lib/components/field-label.svelte';
	import InlineLimitsAdvanced from '$lib/components/inline-limits-advanced.svelte';
	import type { InlineLimitValues } from '$lib/components/inline-limits';
	import { inlineLimitHints, type InlineLimitScope } from '$lib/components/inline-limits-hints';

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
		scope: InlineLimitScope;
		/** the parent's advanced extras (scopes, upstream key…) carry a value, so
		 * the advanced section should start expanded */
		extraAdvancedActive?: boolean;
		/** parent-supplied fields rendered at the top of the advanced section */
		advanced?: Snippet;
	} = $props();

	const id = (field: string) => `${idPrefix}-${field}`;
	// Token/service limits fall through ("inherit") when blank; a policy is the
	// base layer so its hard limits are concrete numbers with no inherit state.
	const limitPlaceholder = untrack(() => (scope === 'policy' ? undefined : 'inherit'));
	// Help moved into hover hints to keep the form scannable.
	const help = $derived(inlineLimitHints(scope));
</script>

<!-- Limits — the common override, always visible -->
<div class="space-y-4">
	<div class="space-y-2">
		<FieldLabel for={id('rateLimitPerMinute')} label="Rate limit (req/min)" hint={help.rate} />
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
	<InlineLimitsAdvanced
		{providers}
		{values}
		{idPrefix}
		{scope}
		{help}
		{limitPlaceholder}
		{extraAdvancedActive}
		{advanced}
	/>
</div>
