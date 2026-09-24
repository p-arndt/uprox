<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import SelectField from '$lib/components/form/select-field.svelte';
	import FormError from '$lib/components/form/form-error.svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import { roleOptions } from './member-roles';

	// The "Invite member" button and its dialog, posting to the invite action.
	// It reads the result of its own submit, so errors from other member
	// actions on the page never show up in here.

	let { open = $bindable(false) }: { open?: boolean } = $props();

	let role = $state('member');
	let pending = $state(false);
	let message = $state<string | null>(null);

	$effect(() => {
		if (!open) message = null;
	});
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
			use:enhance={() => {
				pending = true;
				message = null;
				return async ({ result, update }) => {
					pending = false;
					if (result.type === 'error') {
						message = result.error?.message ?? 'Could not send the invitation';
						return;
					}
					if (result.type === 'failure') {
						message =
							(result.data?.message as string | undefined) ?? 'Could not send the invitation';
						await update({ reset: false });
						return;
					}
					await update({ reset: true });
					if (result.type === 'success') {
						toast.success(`Invitation sent to ${result.data?.email ?? 'the new member'}`);
						role = 'member';
						open = false;
					}
				};
			}}
		>
			<fieldset disabled={pending} class="space-y-4">
				<div class="space-y-2">
					<Label for="email">Email</Label>
					<Input id="email" name="email" type="email" placeholder="person@example.com" required />
				</div>
				<div class="space-y-2">
					<Label for="role">Role</Label>
					<SelectField id="role" name="role" bind:value={role} options={roleOptions} />
				</div>
			</fieldset>
			<FormError {message} />
			<Dialog.Footer>
				<Button type="submit" disabled={pending}>
					{pending ? 'Sending…' : 'Send invitation'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
