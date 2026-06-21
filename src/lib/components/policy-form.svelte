<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import InlineLimitsFields from '$lib/components/inline-limits-fields.svelte';
	import type { InlineLimitValues } from '$lib/components/inline-limits';

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
		/** '' = inherit org default | 'true' = on | 'false' = off */
		tracingEnabled: string;
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

	const id = (field: string) => `${idPrefix}-${field}`;

	// The shared access/limits fields are string-typed; a policy stores its rate &
	// budgets as numbers, so coerce for the initial render (submission is native).
	const inlineValues: InlineLimitValues = untrack(() => ({
		allowedProviders: values.allowedProviders,
		allowedModels: values.allowedModels,
		preferredProvider: values.preferredProvider,
		rateLimitPerMinute: String(values.rateLimitPerMinute),
		dailyBudgetUsd: String(values.dailyBudgetUsd),
		monthlyBudgetUsd: String(values.monthlyBudgetUsd),
		cacheTtlSeconds: values.cacheTtlSeconds,
		tracingEnabled: values.tracingEnabled
	}));
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

	<Separator />

	<InlineLimitsFields {providers} values={inlineValues} {idPrefix} scope="policy" />

	<Dialog.Footer>
		<Button type="submit">{submitLabel}</Button>
	</Dialog.Footer>
</form>
