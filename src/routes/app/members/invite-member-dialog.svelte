<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import SelectField from '$lib/components/form/select-field.svelte';
	import FormError from '$lib/components/form/form-error.svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import { roleOptions } from './member-roles';

	// The "Invite member" button and its dialog, posting to the invite action.

	let { open = $bindable(false), message }: { open?: boolean; message?: string } = $props();

	let role = $state('member');
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger>
		{#snippet child({ props })}
			<Button {...props}>
				<Plus class="size-4" /> Invite member
			</Button>
		{/snippet}
	</Dialog.Trigger>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Invite a member</Dialog.Title>
			<Dialog.Description>
				We'll email an invite. If email isn't configured, copy the invite link from the pending list
				below.
			</Dialog.Description>
		</Dialog.Header>
		<form
			method="post"
			action="?/invite"
			class="space-y-4"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: true })}
		>
			<div class="space-y-2">
				<Label for="email">Email</Label>
				<Input id="email" name="email" type="email" placeholder="person@example.com" required />
			</div>
			<div class="space-y-2">
				<Label for="role">Role</Label>
				<SelectField id="role" name="role" bind:value={role} options={roleOptions} />
			</div>
			<FormError {message} />
			<Dialog.Footer>
				<Button type="submit">Send invitation</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
