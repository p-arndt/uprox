<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';

	let {
		adding,
		message,
		onClose
	}: {
		/** the provider being added to, or null when the dialog is closed */
		adding: { provider: string; label: string; requiresEndpoint: boolean } | null;
		message?: string;
		onClose: () => void;
	} = $props();
</script>

<!-- Add key -->
<Dialog.Root
	open={adding !== null}
	onOpenChange={(v) => {
		if (!v) onClose();
	}}
>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Add {adding?.label} key</Dialog.Title>
			<Dialog.Description
				>Stored encrypted. We only ever show the last 4 characters.</Dialog.Description
			>
		</Dialog.Header>
		<form
			method="post"
			action="?/create"
			class="space-y-4"
			use:enhance={() =>
				async ({ update }) =>
					update()}
		>
			<input type="hidden" name="provider" value={adding?.provider} />
			{#if adding?.requiresEndpoint}
				<div class="space-y-2">
					<Label for="baseUrl">Endpoint URL</Label>
					<Input
						id="baseUrl"
						name="baseUrl"
						type="url"
						placeholder={adding?.provider === 'custom'
							? 'https://api.groq.com/openai/v1'
							: 'https://my-resource.openai.azure.com'}
						autocomplete="off"
						required
					/>
					{#if adding?.provider === 'custom'}
						<p class="text-xs text-muted-foreground">
							The base URL of any OpenAI-compatible API — Groq, OpenRouter, Together, or a
							self-hosted vLLM/Ollama/LiteLLM. Used as-is, so include the full path (e.g.
							<code>/v1</code>). Call models by their exact name.
						</p>
					{:else}
						<p class="text-xs text-muted-foreground">
							Your Azure resource endpoint. Call models by their deployment name (e.g.
							<code>gpt-4o</code>) — no prefix. Add one key per resource and pick it on each
							service.
						</p>
					{/if}
				</div>
			{/if}
			<div class="space-y-2">
				<Label for="secret">API key</Label>
				<Input
					id="secret"
					name="secret"
					type="password"
					placeholder="sk-…"
					autocomplete="off"
					required
				/>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-2">
					<Label for="label">Label</Label>
					<Input id="label" name="label" placeholder="e.g. Azure East US" />
				</div>
				<div class="space-y-2">
					<Label for="priority">Priority</Label>
					<Input id="priority" name="priority" type="number" value="0" />
				</div>
			</div>
			<p class="text-xs text-muted-foreground">
				When a service hasn't pinned a key, the highest-priority one for the provider is used.
			</p>
			{#if message}
				<p class="text-sm text-destructive">{message}</p>
			{/if}
			<Dialog.Footer>
				<Button type="submit">Save key</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
