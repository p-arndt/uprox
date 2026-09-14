<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import EntityDialog from '$lib/components/entity-dialog.svelte';
	import FormError from '$lib/components/form-error.svelte';
	import { endpointPlaceholder } from '$lib/components/form-options';
	import type { ProviderMetaDraft } from '$lib/providers';

	let {
		editingMeta,
		message,
		onClose
	}: {
		/** the secret whose label / endpoint / priority is being edited, or null when closed */
		editingMeta: ProviderMetaDraft | null;
		message?: string;
		onClose: () => void;
	} = $props();
</script>

<!-- Edit details -->
<EntityDialog
	open={editingMeta !== null}
	{onClose}
	title="{editingMeta?.label || 'Provider'} details"
	description="Update the label, endpoint and priority. The stored key is unchanged."
>
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
					placeholder={endpointPlaceholder(editingMeta?.provider)}
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
		<FormError {message} />
		<Dialog.Footer>
			<Button type="submit">Save details</Button>
		</Dialog.Footer>
	</form>
</EntityDialog>
