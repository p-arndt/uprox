<script lang="ts" module>
	import type { InlineLimitValues } from '$lib/components/inline-limits';

	export interface TokenFormValues extends InlineLimitValues {
		id?: string;
		name: string;
		scopes: string[];
		/** '' = no preset attached */
		policyId: string;
	}
</script>

<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { enhance } from '$app/forms';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import InlineLimitsFields from '$lib/components/inline-limits-fields.svelte';
	import { GATEWAY_SCOPES } from '$lib/scopes';

	let {
		action,
		submitLabel,
		idPrefix,
		values,
		policies,
		providers,
		resetOnSuccess = false,
		topFields,
		bottomFields
	}: {
		action: string;
		submitLabel: string;
		/** prefixes field ids so create & edit forms don't collide in the DOM */
		idPrefix: string;
		values: TokenFormValues;
		policies: { id: string; name: string }[];
		providers: { id: string; label: string }[];
		resetOnSuccess?: boolean;
		/** create-only fields rendered above the name (e.g. the service picker) */
		topFields?: Snippet;
		/** create-only fields rendered below (e.g. the expiry picker) */
		bottomFields?: Snippet;
	} = $props();

	// seeded once from the prop; the edit dialog remounts this form per token
	// (keyed on id), so re-seeding happens naturally on mount
	let policyId = $state(untrack(() => values.policyId));

	const id = (field: string) => `${idPrefix}-${field}`;
	const policyLabel = (pid: string) =>
		pid ? (policies.find((p) => p.id === pid)?.name ?? pid) : 'No preset';
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

	{@render topFields?.()}

	<div class="space-y-2">
		<Label for={id('name')}>Token name</Label>
		<Input id={id('name')} name="name" placeholder="production" value={values.name} required />
	</div>

	<div class="space-y-2">
		<Label>Scopes</Label>
		<div class="flex flex-wrap gap-4">
			{#each GATEWAY_SCOPES as scope (scope)}
				<label class="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						name="scopes"
						value={scope}
						checked={values.scopes.includes(scope)}
						class="size-4 accent-foreground"
					/>
					{scope}
				</label>
			{/each}
		</div>
		<p class="text-xs text-muted-foreground">Leave all unchecked to grant every scope.</p>
	</div>

	<div class="space-y-2">
		<Label for={id('policyId')}>Preset</Label>
		<Select.Root type="single" name="policyId" bind:value={policyId}>
			<Select.Trigger id={id('policyId')} class="w-full">{policyLabel(policyId)}</Select.Trigger>
			<Select.Content>
				<Select.Item value="" label="No preset">No preset</Select.Item>
				{#each policies as p (p.id)}
					<Select.Item value={p.id} label={p.name}>{p.name}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		<p class="text-xs text-muted-foreground">
			Optional reusable baseline. The inline overrides below take priority over it field-by-field.
		</p>
	</div>

	<InlineLimitsFields {providers} {values} idPrefix={id('inline')} scope="token" />

	{@render bottomFields?.()}

	<Dialog.Footer>
		<Button type="submit">{submitLabel}</Button>
	</Dialog.Footer>
</form>
