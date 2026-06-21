<script lang="ts" module>
	import type { InlineLimitValues } from '$lib/components/inline-limits';

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
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import InlineLimitsFields from '$lib/components/inline-limits-fields.svelte';
	import CheckboxGroup from '$lib/components/checkbox-group.svelte';
	import FieldHint from '$lib/components/field-hint.svelte';
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
		/** services the token can belong to; empty hides the picker entirely */
		services?: { id: string; name: string }[];
		resetOnSuccess?: boolean;
		/** create-only fields rendered above the name (e.g. the service picker) */
		topFields?: Snippet;
		/** create-only fields rendered below (e.g. the expiry picker) */
		bottomFields?: Snippet;
	} = $props();

	// seeded once from the prop; the edit dialog remounts this form per token
	// (keyed on id), so re-seeding happens naturally on mount
	let policyId = $state(untrack(() => values.policyId));
	let serviceId = $state(untrack(() => values.serviceId ?? ''));

	const id = (field: string) => `${idPrefix}-${field}`;
	const policyLabel = (pid: string) =>
		pid ? (policies.find((p) => p.id === pid)?.name ?? pid) : 'No preset';
	// '' renders as "Default" — the catch-all service the server assigns
	const serviceLabel = (sid: string) =>
		sid ? (services.find((s) => s.id === sid)?.name ?? sid) : 'Default';
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
			<div class="flex items-center gap-1.5">
				<Label for={id('serviceId')}>Service</Label>
				<FieldHint
					text="Which service this token belongs to. Leave on Default to start — you can move it into a service later."
				/>
			</div>
			<Select.Root type="single" name="serviceId" bind:value={serviceId}>
				<Select.Trigger id={id('serviceId')} class="w-full">
					{serviceLabel(serviceId)}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="" label="Default">Default</Select.Item>
					{#each services as s (s.id)}
						<Select.Item value={s.id} label={s.name}>{s.name}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	{/if}

	<div class="space-y-2">
		<div class="flex items-center gap-1.5">
			<Label for={id('policyId')}>Preset</Label>
			<FieldHint
				text="Optional reusable baseline. The overrides below take priority field-by-field."
			/>
		</div>
		<Select.Root type="single" name="policyId" bind:value={policyId}>
			<Select.Trigger id={id('policyId')} class="w-full">{policyLabel(policyId)}</Select.Trigger>
			<Select.Content>
				<Select.Item value="" label="No preset">No preset</Select.Item>
				{#each policies as p (p.id)}
					<Select.Item value={p.id} label={p.name}>{p.name}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	{@render bottomFields?.()}

	<Separator />

	<InlineLimitsFields
		{providers}
		{values}
		idPrefix={id('inline')}
		scope="token"
		extraAdvancedActive={values.scopes.length > 0}
	>
		{#snippet advanced()}
			<div class="space-y-2">
				<div class="flex text-muted-foreground items-center gap-1.5">
					<Label>Scopes</Label>
					<FieldHint text="Leave all unchecked to grant every scope." />
				</div>
				<CheckboxGroup
					name="scopes"
					idPrefix={id('scope')}
					options={scopeOptions}
					selected={values.scopes}
				/>
			</div>
		{/snippet}
	</InlineLimitsFields>

	<Dialog.Footer>
		<Button type="submit">{submitLabel}</Button>
	</Dialog.Footer>
</form>
