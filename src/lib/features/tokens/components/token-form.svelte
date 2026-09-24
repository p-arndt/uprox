<script lang="ts" module>
	import type { InlineLimitValues } from '$lib/features/policies/inline-limits';

	export interface TokenFormValues extends InlineLimitValues {
		id?: string;
		name: string;
		scopes: string[];
		/** '' = no preset attached */
		policyId: string;
		/** owning service; '' = let the server use the Default service */
		serviceId?: string;
	}
</script>

<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { enhance } from '$app/forms';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import InlineLimitsFields from '$lib/features/policies/components/inline-limits-fields.svelte';
	import CheckboxGroup from '$lib/components/form/checkbox-group.svelte';
	import FieldLabel from '$lib/components/form/field-label.svelte';
	import FormError from '$lib/components/form/form-error.svelte';
	import SelectField from '$lib/components/form/select-field.svelte';
	import { presetOptions } from '$lib/components/form/form-options';
	import { GATEWAY_SCOPES } from '$lib/scopes';

	let {
		action,
		submitLabel,
		idPrefix,
		values,
		policies,
		providers,
		services = [],
		resetOnSuccess = false,
		message,
		topFields,
		afterServiceFields,
		advancedFields
	}: {
		action: string;
		submitLabel: string;
		/** prefixes field ids so create & edit forms don't collide in the DOM */
		idPrefix: string;
		values: TokenFormValues;
		policies: { id: string; name: string }[];
		providers: { id: string; label: string }[];
		/** services the token can belong to; empty hides the picker entirely */
		services?: { id: string; name: string }[];
		resetOnSuccess?: boolean;
		/** server-side validation message, shown above the submit button */
		message?: string;
		/** fields rendered above the name */
		topFields?: Snippet;
		/** always-visible fields rendered right after the service picker (e.g. the expiry picker) */
		afterServiceFields?: Snippet;
		/** fields appended to the collapsed Advanced section (e.g. the re-copy switch) */
		advancedFields?: Snippet;
	} = $props();

	// seeded once from the prop; the edit dialog remounts this form per token
	// (keyed on id), so re-seeding happens naturally on mount
	let policyId = $state(untrack(() => values.policyId));
	let serviceId = $state(untrack(() => values.serviceId ?? ''));

	const id = (field: string) => `${idPrefix}-${field}`;
	// listServices() already includes the real Default service, so no synthetic
	// entry here; '' only survives when Default doesn't exist yet
	const serviceOptions = $derived(services.map((s) => ({ value: s.id, label: s.name })));
	const scopeOptions = GATEWAY_SCOPES.map((s) => ({ value: s, label: s }));
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

	{#if services.length > 0}
		<div class="space-y-2">
			<FieldLabel
				for={id('serviceId')}
				label="Service"
				hint="Which service this token belongs to. Leave on Default to start — you can move it into a service later."
			/>
			<SelectField
				id={id('serviceId')}
				name="serviceId"
				bind:value={serviceId}
				options={serviceOptions}
				fallback="Default"
			/>
		</div>
	{/if}

	{@render afterServiceFields?.()}

	<Separator />

	<InlineLimitsFields
		{providers}
		{values}
		idPrefix={id('inline')}
		scope="token"
		extraAccessActive={values.scopes.length > 0}
		extraAdvancedActive={!!values.policyId}
	>
		{#snippet accessExtra()}
			<div class="space-y-2">
				<FieldLabel
					label="Scopes"
					hint="Leave all unchecked to grant every scope."
					class="text-muted-foreground"
				/>
				<CheckboxGroup
					name="scopes"
					idPrefix={id('scope')}
					options={scopeOptions}
					selected={values.scopes}
				/>
			</div>
		{/snippet}
		{#snippet advanced()}
			<div class="space-y-2">
				<FieldLabel
					for={id('policyId')}
					label="Preset"
					hint="Optional reusable baseline. The overrides take priority field-by-field."
				/>
				<SelectField
					id={id('policyId')}
					name="policyId"
					bind:value={policyId}
					options={presetOptions(policies)}
				/>
			</div>
			{@render advancedFields?.()}
		{/snippet}
	</InlineLimitsFields>

	<FormError {message} />

	<Dialog.Footer>
		<Button type="submit">{submitLabel}</Button>
	</Dialog.Footer>
</form>
