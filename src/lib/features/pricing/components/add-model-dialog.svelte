<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { LONG_CONTEXT_MIN_PROMPT_TOKENS } from '$lib/features/pricing/pricing';
	import SelectField from '$lib/components/form/select-field.svelte';
	import FormError from '$lib/components/form/form-error.svelte';

	const longThresholdLabel = `${Math.round(LONG_CONTEXT_MIN_PROMPT_TOKENS / 1000)}k`;
	const AUTO_READ = 'auto (0.1× input)';
	const AUTO_WRITE = 'auto (1.25× input)';

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
	const providerOptions = $derived([
		{ value: '', label: '—' },
		...providers.map((p) => ({ value: p.id, label: p.label }))
	]);
</script>

{#snippet rateField(name: string, label: string, placeholder: string, required = false)}
	<div class="space-y-2">
		<Label for={name}>{label}</Label>
		<Input id={name} {name} type="number" step="0.0001" min="0" {placeholder} {required} />
	</div>
{/snippet}

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
				<SelectField
					id="provider"
					name="provider"
					bind:value={provider}
					options={providerOptions}
					fallback="—"
				/>
			</div>
			<div class="grid grid-cols-2 gap-4">
				{@render rateField('inputPerMtok', 'Input $ / 1M', '2.5', true)}
				{@render rateField('outputPerMtok', 'Output $ / 1M', '10', true)}
			</div>
			<div class="grid grid-cols-2 gap-4">
				{@render rateField('cacheReadPerMtok', 'Cache read $ / 1M', AUTO_READ)}
				{@render rateField('cacheWritePerMtok', 'Cache write $ / 1M', AUTO_WRITE)}
			</div>
			<p class="text-xs text-muted-foreground">
				Cache prices are optional — leave blank to fall back to a multiple of the input price (read
				0.1×, write 1.25×). Cache writes apply to Anthropic and GPT-5.6 or later; elsewhere a
				written token bills as plain input.
			</p>

			<div class="space-y-3 rounded-lg border p-3">
				<p class="text-xs text-muted-foreground">
					Long context (optional) — rates billed for the whole request once its prompt reaches {longThresholdLabel}
					tokens. Leave the input rate blank for models with a single rate card.
				</p>
				<div class="grid grid-cols-2 gap-4">
					{@render rateField('longInputPerMtok', 'Input $ / 1M', 'none')}
					{@render rateField('longOutputPerMtok', 'Output $ / 1M', 'none')}
					{@render rateField('longCacheReadPerMtok', 'Cache read $ / 1M', AUTO_READ)}
					{@render rateField('longCacheWritePerMtok', 'Cache write $ / 1M', AUTO_WRITE)}
				</div>
			</div>
			<FormError {message} />
			<Dialog.Footer>
				<Button type="submit">Add model</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
