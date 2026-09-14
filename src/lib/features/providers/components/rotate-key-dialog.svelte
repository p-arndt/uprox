<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import EntityDialog from '$lib/components/entity-dialog.svelte';
	import FormError from '$lib/components/form-error.svelte';
	import type { RotateKeyDraft } from '$lib/features/providers/providers';

	let {
		rotating,
		message,
		onClose
	}: {
		/** the secret being rotated, or null when the dialog is closed */
		rotating: RotateKeyDraft | null;
		message?: string;
		onClose: () => void;
	} = $props();
</script>

<!-- Rotate key -->
<EntityDialog
	open={rotating !== null}
	{onClose}
	title="Rotate {rotating?.label} key"
	description={rotating?.authScheme === 'basic'
		? 'Replace the stored basic-auth credentials. The endpoint and label are unchanged.'
		: 'Replace the stored key. The endpoint and label are unchanged.'}
>
	<form
		method="post"
		action="?/rotate"
		class="space-y-4"
		use:enhance={() =>
			async ({ update }) =>
				update()}
	>
		<input type="hidden" name="id" value={rotating?.id} />
		<input type="hidden" name="provider" value={rotating?.provider} />
		{#if rotating?.authScheme === 'basic'}
			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-2">
					<Label for="rotate-username">Username</Label>
					<Input id="rotate-username" name="username" autocomplete="off" />
				</div>
				<div class="space-y-2">
					<Label for="rotate-password">Password</Label>
					<Input id="rotate-password" name="password" type="password" autocomplete="off" />
				</div>
			</div>
			<p class="text-xs text-muted-foreground">
				Leave both blank to remove basic auth from this endpoint.
			</p>
		{:else}
			<div class="space-y-2">
				<Label for="rotate-secret">New API key</Label>
				<Input
					id="rotate-secret"
					name="secret"
					type="password"
					placeholder="sk-…"
					autocomplete="off"
					required
				/>
			</div>
		{/if}
		<FormError {message} />
		<Dialog.Footer>
			<Button type="submit">Rotate key</Button>
		</Dialog.Footer>
	</form>
</EntityDialog>
