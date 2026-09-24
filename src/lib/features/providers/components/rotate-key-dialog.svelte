<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import EntityDialog from '$lib/components/form/entity-dialog.svelte';
	import FormError from '$lib/components/form/form-error.svelte';
	import { keyPlaceholder, type RotateKeyDraft } from '$lib/features/providers/providers';

	let {
		rotating,
		message,
		connectionFailed = false,
		onClose
	}: {
		/** the secret being rotated, or null when the dialog is closed */
		rotating: RotateKeyDraft | null;
		message?: string;
		/** the connection test rejected the new credential; offer "Save anyway" */
		connectionFailed?: boolean;
		onClose: () => void;
	} = $props();

	let pending = $state(false);
	// "Save anyway" skips the probe, so the pending label shouldn't claim a test
	let skipping = $state(false);
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
		use:enhance={({ submitter }) => {
			pending = true;
			skipping = submitter?.getAttribute('name') === 'skipTest';
			return async ({ update }) => {
				await update();
				pending = false;
			};
		}}
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
					placeholder={keyPlaceholder(rotating?.provider)}
					autocomplete="off"
					required
				/>
			</div>
		{/if}
		<FormError {message} />
		<Dialog.Footer>
			<!-- primary first in the DOM so Enter re-runs the test, not "Save anyway" -->
			<Button type="submit" disabled={pending}>
				{pending ? (skipping ? 'Saving…' : 'Testing connection…') : 'Rotate key'}
			</Button>
			{#if connectionFailed}
				<Button
					type="submit"
					name="skipTest"
					value="1"
					variant="outline"
					class="sm:order-first"
					disabled={pending}
				>
					Save anyway
				</Button>
			{/if}
		</Dialog.Footer>
	</form>
</EntityDialog>
