<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';

	let {
		rotating,
		message,
		onClose
	}: {
		/** the secret being rotated, or null when the dialog is closed */
		rotating: { id: string; label: string } | null;
		message?: string;
		onClose: () => void;
	} = $props();
</script>

<!-- Rotate key -->
<Dialog.Root
	open={rotating !== null}
	onOpenChange={(v) => {
		if (!v) onClose();
	}}
>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Rotate {rotating?.label} key</Dialog.Title>
			<Dialog.Description
				>Replace the stored key. The endpoint and label are unchanged.</Dialog.Description
			>
		</Dialog.Header>
		<form
			method="post"
			action="?/rotate"
			class="space-y-4"
			use:enhance={() =>
				async ({ update }) =>
					update()}
		>
			<input type="hidden" name="id" value={rotating?.id} />
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
			{#if message}
				<p class="text-sm text-destructive">{message}</p>
			{/if}
			<Dialog.Footer>
				<Button type="submit">Rotate key</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
