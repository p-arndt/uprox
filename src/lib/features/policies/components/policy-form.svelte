<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import FormError from '$lib/components/form/form-error.svelte';
	import InlineLimitsFields from '$lib/features/policies/components/inline-limits-fields.svelte';
	import type { InlineLimitValues } from '$lib/features/policies/inline-limits';

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
		/** '' = inherit the instance default */
		cacheTtlSeconds: string;
	}

	let {
		providers,
		action,
		submitLabel,
		values,
		idPrefix,
		modelSuggestions = [],
		message,
		resetOnSuccess = false
	}: {
		providers: { id: string; label: string }[];
		action: string;
		submitLabel: string;
		values: PolicyFormValues;
		/** prefixes field ids so create & edit forms don't collide in the DOM */
		idPrefix: string;
		/** known model ids for the allowed-models input */
		modelSuggestions?: string[];
		/** server-side validation message for this form, shown above the submit button */
		message?: string;
		resetOnSuccess?: boolean;
	} = $props();

	const id = (field: string) => `${idPrefix}-${field}`;
	let pending = $state(false);

	// The shared access/limits fields are string-typed; a policy stores its rate &
	// budgets as numbers, so coerce for the initial render (submission is native).
	const inlineValues: InlineLimitValues = untrack(() => ({
		allowedProviders: values.allowedProviders,
		allowedModels: values.allowedModels,
		preferredProvider: values.preferredProvider,
		rateLimitPerMinute: String(values.rateLimitPerMinute),
		dailyBudgetUsd: String(values.dailyBudgetUsd),
		monthlyBudgetUsd: String(values.monthlyBudgetUsd),
		cacheTtlSeconds: values.cacheTtlSeconds
	}));
</script>

<form
	method="post"
	{action}
	class="space-y-4"
	use:enhance={() => {
		pending = true;
		return async ({ update }) => {
			await update({ reset: resetOnSuccess });
			pending = false;
		};
	}}
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

	<Separator />

	<InlineLimitsFields
		{providers}
		values={inlineValues}
		{idPrefix}
		{modelSuggestions}
		scope="policy"
	/>

	<FormError {message} />

	<Dialog.Footer>
		<Button type="submit" disabled={pending}>
			{#if pending}<Spinner />{/if}
			{submitLabel}
		</Button>
	</Dialog.Footer>
</form>
