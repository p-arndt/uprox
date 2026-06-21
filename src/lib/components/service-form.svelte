<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import InlineLimitsFields from '$lib/components/inline-limits-fields.svelte';
	import FieldHint from '$lib/components/field-hint.svelte';
	import type { InlineLimitValues } from '$lib/components/inline-limits';

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
	const typeLabel = (v: string) => typeOptions.find((o) => o.value === v)?.label ?? v;
	const policyLabel = (pid: string) =>
		pid ? (policies.find((p) => p.id === pid)?.name ?? pid) : 'No preset';

	const secretName = $derived(
		new Map(secretOptions.map((s) => [s.id, `${s.providerLabel} — ${s.label || `••••${s.hint}`}`]))
	);
	const secretLabel = (sid: string) =>
		sid ? (secretName.get(sid) ?? sid) : 'Automatic (default key)';
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
			<Select.Root type="single" name="type" bind:value={type}>
				<Select.Trigger id={id('type')} class="w-full">{typeLabel(type)}</Select.Trigger>
				<Select.Content>
					{#each typeOptions as o (o.value)}
						<Select.Item value={o.value} label={o.label}>{o.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
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

	<div class="space-y-2">
		<div class="flex items-center gap-1.5">
			<Label for={id('policyId')}>Preset</Label>
			<FieldHint text="Optional reusable baseline. The fields below override it field-by-field." />
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

	<InlineLimitsFields
		{providers}
		{values}
		idPrefix={id('inline')}
		scope="service"
		extraAdvancedActive={!!values.providerSecretId}
	>
		{#snippet advanced()}
			{#if secretOptions.length > 0}
				<div class="space-y-2">
					<div class="flex items-center gap-1.5">
						<Label for={id('providerSecretId')}>Upstream key</Label>
						<FieldHint
							text="Pin which provider key this service uses — e.g. a specific Azure resource."
						/>
					</div>
					<Select.Root type="single" name="providerSecretId" bind:value={providerSecretId}>
						<Select.Trigger id={id('providerSecretId')} class="w-full">
							{secretLabel(providerSecretId)}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="" label="Automatic (default key)">
								Automatic (default key)
							</Select.Item>
							{#each secretOptions as s (s.id)}
								<Select.Item value={s.id} label={secretName.get(s.id) ?? s.id}>
									{secretName.get(s.id) ?? s.id}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			{/if}
		{/snippet}
	</InlineLimitsFields>

	<Dialog.Footer>
		<Button type="submit">{submitLabel}</Button>
	</Dialog.Footer>
</form>
