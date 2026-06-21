<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import TokenForm, { type TokenFormValues } from '$lib/components/token-form.svelte';
	import { emptyInlineLimits } from '$lib/components/inline-limits';

	let {
		open = $bindable(false),
		disabled = false,
		services,
		policies,
		providers,
		recopyDefault,
		message
	}: {
		open?: boolean;
		disabled?: boolean;
		services: { id: string; name: string }[];
		policies: { id: string; name: string }[];
		providers: { id: string; label: string }[];
		recopyDefault: boolean;
		message?: string;
	} = $props();

	let expiresInDays = $state('0');
	const expiryOptions = [
		{ value: '0', label: 'Never' },
		{ value: '30', label: 'In 30 days' },
		{ value: '90', label: 'In 90 days' },
		{ value: '365', label: 'In 1 year' }
	];
	// pre-checks the create-form "allow re-copying" box from the instance default
	let recopyable = $state(false);

	const createValues: TokenFormValues = {
		...emptyInlineLimits(),
		name: '',
		scopes: [],
		policyId: ''
	};

	// Seed the create-form checkbox from the instance default each time it opens.
	$effect(() => {
		if (open) recopyable = recopyDefault;
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger>
		{#snippet child({ props })}
			<Button {...props} {disabled}>+ New token</Button>
		{/snippet}
	</Dialog.Trigger>
	<Dialog.Content class="max-h-[88vh] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Create machine token</Dialog.Title>
			<Dialog.Description>The secret is shown once — store it safely.</Dialog.Description>
		</Dialog.Header>
		<TokenForm
			action="?/create"
			submitLabel="Create token"
			idPrefix="create"
			values={createValues}
			{policies}
			{providers}
			{services}
			resetOnSuccess
		>
			{#snippet bottomFields()}
				<div class="space-y-2">
					<Label for="expiresInDays">Expires</Label>
					<Select.Root type="single" name="expiresInDays" bind:value={expiresInDays}>
						<Select.Trigger id="expiresInDays" class="w-full">
							{expiryOptions.find((o) => o.value === expiresInDays)?.label}
						</Select.Trigger>
						<Select.Content>
							{#each expiryOptions as o (o.value)}
								<Select.Item value={o.value} label={o.label}>{o.label}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<input type="hidden" name="recopyable" value={String(recopyable)} />
				<div class="space-y-1.5 rounded-lg border p-3">
					<div class="flex items-center justify-between gap-4">
						<Label for="recopyable">Allow re-copying later</Label>
						<Switch id="recopyable" bind:checked={recopyable} />
					</div>
					<p class="text-xs text-muted-foreground">
						Stores the secret encrypted so you can reveal and copy it again from this page. Off
						keeps it hash-only — shown once, then unrecoverable (more secure).
					</p>
				</div>
				{#if message}
					<p class="text-sm text-destructive">{message}</p>
				{/if}
			{/snippet}
		</TokenForm>
	</Dialog.Content>
</Dialog.Root>
