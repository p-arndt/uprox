<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';

	let {
		open = $bindable(false),
		providers,
		/** preselect this provider when opened from a provider-filtered tab */
		defaultProvider = '',
		message
	}: {
		open?: boolean;
		providers: { id: string; label: string }[];
		defaultProvider?: string;
		/** server-side validation error from the create action */
		message?: string;
	} = $props();

	let provider = $state('');

	// Seed the provider select from the active tab each time the dialog opens.
	$effect(() => {
		if (open) provider = defaultProvider;
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Add model price</Dialog.Title>
			<Dialog.Description>Prices are in USD per 1,000,000 tokens.</Dialog.Description>
		</Dialog.Header>
		<form
			method="post"
			action="?/create"
			class="space-y-4"
			use:enhance={() =>
				async ({ result, update }) => {
					await update();
					if (result.type === 'success') open = false;
				}}
		>
			<div class="space-y-2">
				<Label for="model">Model</Label>
				<Input id="model" name="model" placeholder="gpt-4o" required />
				<p class="text-xs text-muted-foreground">
					Matched by longest prefix, e.g. <code>gpt-4o</code> covers
					<code>gpt-4o-2024-08-06</code>.
				</p>
			</div>
			<div class="space-y-2">
				<Label for="provider">Provider (optional)</Label>
				<Select.Root type="single" name="provider" bind:value={provider}>
					<Select.Trigger id="provider" class="w-full">
						{providers.find((p) => p.id === provider)?.label ?? '—'}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="" label="—">—</Select.Item>
						{#each providers as prov (prov.id)}
							<Select.Item value={prov.id} label={prov.label}>{prov.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-2">
					<Label for="inputPerMtok">Input $ / 1M</Label>
					<Input
						id="inputPerMtok"
						name="inputPerMtok"
						type="number"
						step="0.0001"
						min="0"
						placeholder="2.5"
						required
					/>
				</div>
				<div class="space-y-2">
					<Label for="outputPerMtok">Output $ / 1M</Label>
					<Input
						id="outputPerMtok"
						name="outputPerMtok"
						type="number"
						step="0.0001"
						min="0"
						placeholder="10"
						required
					/>
				</div>
			</div>
			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-2">
					<Label for="cacheReadPerMtok">Cache read $ / 1M</Label>
					<Input
						id="cacheReadPerMtok"
						name="cacheReadPerMtok"
						type="number"
						step="0.0001"
						min="0"
						placeholder="auto (0.1× input)"
					/>
				</div>
				<div class="space-y-2">
					<Label for="cacheWritePerMtok">Cache write $ / 1M</Label>
					<Input
						id="cacheWritePerMtok"
						name="cacheWritePerMtok"
						type="number"
						step="0.0001"
						min="0"
						placeholder="auto (1.25× input)"
					/>
				</div>
			</div>
			<p class="text-xs text-muted-foreground">
				Cache prices are optional — leave blank to fall back to a multiple of the input price (read
				0.1×, write 1.25×). Cache writes apply to Anthropic only; OpenAI/Azure don't charge to write
				a cache entry.
			</p>
			{#if message}
				<p class="text-sm text-destructive">{message}</p>
			{/if}
			<Dialog.Footer>
				<Button type="submit">Add model</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
