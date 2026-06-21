<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';

	let {
		editingMeta,
		message,
		onClose
	}: {
		/** the secret whose label / endpoint / priority is being edited, or null when closed */
		editingMeta: {
			id: string;
			provider: string;
			label: string;
			requiresEndpoint: boolean;
			baseUrl: string;
			priority: number;
		} | null;
		message?: string;
		onClose: () => void;
	} = $props();
</script>

<!-- Edit details -->
<Dialog.Root
	open={editingMeta !== null}
	onOpenChange={(v) => {
		if (!v) onClose();
	}}
>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{editingMeta?.label || 'Provider'} details</Dialog.Title>
			<Dialog.Description
				>Update the label, endpoint and priority. The stored key is unchanged.</Dialog.Description
			>
		</Dialog.Header>
		<form
			method="post"
			action="?/editMeta"
			class="space-y-4"
			use:enhance={() =>
				async ({ update }) =>
					update()}
		>
			<input type="hidden" name="id" value={editingMeta?.id} />
			<input type="hidden" name="provider" value={editingMeta?.provider} />
			{#if editingMeta?.requiresEndpoint}
				<div class="space-y-2">
					<Label for="meta-baseUrl">Endpoint URL</Label>
					<Input
						id="meta-baseUrl"
						name="baseUrl"
						type="url"
						placeholder={editingMeta?.provider === 'custom'
							? 'https://api.groq.com/openai/v1'
							: editingMeta?.provider === 'ollama'
								? 'http://localhost:11434'
								: 'https://my-resource.openai.azure.com'}
						value={editingMeta?.baseUrl ?? ''}
						autocomplete="off"
						required
					/>
				</div>
			{/if}
			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-2">
					<Label for="meta-label">Label</Label>
					<Input
						id="meta-label"
						name="label"
						value={editingMeta?.label ?? ''}
						placeholder="e.g. Azure East US"
					/>
				</div>
				<div class="space-y-2">
					<Label for="meta-priority">Priority</Label>
					<Input
						id="meta-priority"
						name="priority"
						type="number"
						value={editingMeta?.priority ?? 0}
					/>
				</div>
			</div>
			{#if message}
				<p class="text-sm text-destructive">{message}</p>
			{/if}
			<Dialog.Footer>
				<Button type="submit">Save details</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
