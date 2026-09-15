<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import InlineLimitsFields from '$lib/features/policies/components/inline-limits-fields.svelte';
	import FieldLabel from '$lib/components/form/field-label.svelte';
	import SelectField from '$lib/components/form/select-field.svelte';
	import { presetOptions } from '$lib/components/form/form-options';
	import type { InlineLimitValues } from '$lib/features/policies/inline-limits';

	export interface ServiceFormValues extends InlineLimitValues {
		id?: string;
		name: string;
		type: string;
		description: string;
		/** '' = no preset attached */
		policyId: string;
		/** '' = automatic (default key) */
		providerSecretId: string;
	}

	let {
		action,
		submitLabel,
		idPrefix,
		values,
		policies,
		providers,
		secretOptions = [],
		resetOnSuccess = false
	}: {
		action: string;
		submitLabel: string;
		/** prefixes field ids so create & edit forms don't collide in the DOM */
		idPrefix: string;
		values: ServiceFormValues;
		policies: { id: string; name: string }[];
		providers: { id: string; label: string }[];
		/** upstream-key options; only passed when a provider has more than one key */
		secretOptions?: {
			id: string;
			providerLabel: string;
			label: string | null;
			hint: string | null;
		}[];
		resetOnSuccess?: boolean;
	} = $props();

	const id = (field: string) => `${idPrefix}-${field}`;

	// Selects need their own state; the edit dialog remounts this form per service
	// (keyed on id), so re-seeding from the prop happens naturally on mount.
	let type = $state(untrack(() => values.type));
	let policyId = $state(untrack(() => values.policyId));
	let providerSecretId = $state(untrack(() => values.providerSecretId));

	const typeOptions = [
		{ value: 'app', label: 'App' },
		{ value: 'agent', label: 'Agent' },
		{ value: 'workload', label: 'Workload' }
	];
	const secretSelectOptions = $derived([
		{ value: '', label: 'Automatic (default key)' },
		...secretOptions.map((s) => ({
			value: s.id,
			label: `${s.providerLabel} — ${s.label || `••••${s.hint}`}`
		}))
	]);
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
		<Input id={id('name')} name="name" placeholder="support-agent" value={values.name} required />
	</div>

	<div class="grid grid-cols-2 gap-4">
		<div class="space-y-2">
			<Label for={id('type')}>Type</Label>
			<SelectField id={id('type')} name="type" bind:value={type} options={typeOptions} />
		</div>
		<div class="space-y-2">
			<Label for={id('description')}>Description</Label>
			<Input
				id={id('description')}
				name="description"
				placeholder="Optional"
				value={values.description}
			/>
		</div>
	</div>

	<Separator />

	<InlineLimitsFields
		{providers}
		{values}
		idPrefix={id('inline')}
		scope="service"
		extraAccessActive={!!values.providerSecretId}
		extraAdvancedActive={!!values.policyId}
	>
		{#snippet accessExtra()}
			{#if secretOptions.length > 0}
				<div class="space-y-2">
					<FieldLabel
						for={id('providerSecretId')}
						label="Upstream key"
						hint="Pin which provider key this service uses — e.g. a specific Azure resource."
					/>
					<SelectField
						id={id('providerSecretId')}
						name="providerSecretId"
						bind:value={providerSecretId}
						options={secretSelectOptions}
					/>
				</div>
			{/if}
		{/snippet}
		{#snippet advanced()}
			<div class="space-y-2">
				<FieldLabel
					for={id('policyId')}
					label="Preset"
					hint="Optional reusable baseline. The other fields override it field-by-field."
				/>
				<SelectField
					id={id('policyId')}
					name="policyId"
					bind:value={policyId}
					options={presetOptions(policies)}
				/>
			</div>
		{/snippet}
	</InlineLimitsFields>

	<Dialog.Footer>
		<Button type="submit">{submitLabel}</Button>
	</Dialog.Footer>
</form>
