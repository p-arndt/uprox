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
	import FieldLabel from '$lib/components/form/field-label.svelte';
	import SelectField from '$lib/components/form/select-field.svelte';
	import { presetOptions } from '$lib/components/form/form-options';
	import type { InlineLimitValues } from '$lib/features/policies/inline-limits';
	import {
		inheritedForServiceForm,
		type InstanceDefaults,
		type PresetLayerRow
	} from '$lib/features/policies/effective-config';
	import { SERVICE_TYPE_OPTIONS } from './service-display';

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
		defaults,
		message,
		resetOnSuccess = false
	}: {
		action: string;
		submitLabel: string;
		/** prefixes field ids so create & edit forms don't collide in the DOM */
		idPrefix: string;
		values: ServiceFormValues;
		/** with their config columns, so blank fields can show what they inherit */
		policies: (PresetLayerRow & { name: string })[];
		providers: { id: string; label: string }[];
		/** upstream-key options; only passed when a provider has more than one key */
		secretOptions?: {
			id: string;
			providerLabel: string;
			label: string | null;
			hint: string | null;
		}[];
		/** instance defaults; omitted = blank fields show a bare "inherit" */
		defaults?: InstanceDefaults;
		/** the server's error for this form's last submit, shown above the submit button */
		message?: string | null;
		resetOnSuccess?: boolean;
	} = $props();

	const id = (field: string) => `${idPrefix}-${field}`;

	// Selects need their own state; the edit dialog remounts this form per service
	// (keyed on id), so re-seeding from the prop happens naturally on mount.
	let type = $state(untrack(() => values.type));
	let policyId = $state(untrack(() => values.policyId));
	let providerSecretId = $state(untrack(() => values.providerSecretId));

	// follows the preset select live, so switching presets updates the placeholders
	const inherited = $derived(defaults && inheritedForServiceForm({ policyId, policies, defaults }));

	let pending = $state(false);
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
	use:enhance={() => {
		pending = true;
		return async ({ update }) => {
			try {
				await update({ reset: resetOnSuccess });
			} finally {
				pending = false;
			}
		};
	}}
>
	{#if values.id}
		<input type="hidden" name="id" value={values.id} />
	{/if}

	<div class="space-y-2">
		<Label for={id('name')}>Name</Label>
		<Input id={id('name')} name="name" placeholder="support-agent" value={values.name} required />
	</div>

	<div class="grid grid-cols-1 gap-4 sm:grid-cols-[10rem_1fr]">
		<div class="space-y-2">
			<Label for={id('type')}>Type</Label>
			<SelectField id={id('type')} name="type" bind:value={type} options={SERVICE_TYPE_OPTIONS} />
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

	<div class="space-y-2">
		<Label for={id('policyId')}>Preset</Label>
		<SelectField
			id={id('policyId')}
			name="policyId"
			bind:value={policyId}
			options={presetOptions(policies)}
		/>
		<p class="text-xs text-muted-foreground">
			A reusable baseline. The fields below override or narrow it for this service.
		</p>
	</div>

	<Separator />

	<InlineLimitsFields
		{providers}
		{values}
		{inherited}
		idPrefix={id('inline')}
		scope="service"
		extraAccessActive={!!values.providerSecretId}
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
	</InlineLimitsFields>

	<FormError {message} />

	<Dialog.Footer>
		<Button type="submit" disabled={pending}>
			{#if pending}<Spinner />{/if}
			{submitLabel}
		</Button>
	</Dialog.Footer>
</form>
