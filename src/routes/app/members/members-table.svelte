<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import ConfirmAction from '$lib/components/form/confirm-action.svelte';
	import { formatDateTime } from '$lib/format';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import type { PageData } from './$types';
	import { isEscalation, roleLabel, roleOptions, roleVariant } from './member-roles';

	// Workspace members with inline role changes and removal.

	type Member = PageData['members'][number];

	let {
		members,
		currentUserId,
		canManage
	}: {
		members: Member[];
		currentUserId: string;
		canManage: boolean;
	} = $props();

	// One hidden form carries every role change; the selects only decide what
	// goes into it. `pending` holds the in-flight change so the row shows the
	// new role while saving and falls back to the stored one if it fails.
	let roleForm: HTMLFormElement | undefined = $state();
	let pending = $state<{ memberId: string; role: string } | null>(null);
	let confirm = $state<{ member: Member; role: string } | null>(null);

	function submitRole(memberId: string, role: string) {
		if (!roleForm) return;
		(roleForm.elements.namedItem('memberId') as HTMLInputElement).value = memberId;
		(roleForm.elements.namedItem('role') as HTMLInputElement).value = role;
		pending = { memberId, role };
		roleForm.requestSubmit();
	}

	function requestRole(member: Member, role: string) {
		if (role === member.role || pending) return;
		if (isEscalation(member.role, role)) confirm = { member, role };
		else submitRole(member.id, role);
	}

	function confirmRole() {
		if (!confirm) return;
		submitRole(confirm.member.id, confirm.role);
		confirm = null;
	}
</script>

<form
	method="post"
	action="?/changeRole"
	class="hidden"
	bind:this={roleForm}
	use:enhance={() =>
		async ({ result, update }) => {
			const role = pending?.role ?? '';
			if (result.type === 'error') {
				pending = null;
				toast.error(result.error?.message ?? 'Could not change the role');
				return;
			}
			await update({ reset: false });
			pending = null;
			if (result.type === 'success') toast.success(`Role updated to ${roleLabel(role)}`);
			else if (result.type === 'failure') {
				toast.error((result.data?.message as string | undefined) ?? 'Could not change the role');
			}
		}}
>
	<input type="hidden" name="memberId" />
	<input type="hidden" name="role" />
</form>

<AlertDialog.Root
	open={confirm !== null}
	onOpenChange={(open) => {
		if (!open) confirm = null;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>
				Make {confirm?.member.name}
				{confirm?.role === 'admin' ? 'an admin' : 'the owner'}?
			</AlertDialog.Title>
			<AlertDialog.Description>
				They get full access: providers, presets, services, tokens, model prices, settings and
				members, including removing other admins.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={confirmRole}>
				Make {confirm ? roleLabel(confirm.role).toLowerCase() : ''}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<div class="rounded-xl border">
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>Name</Table.Head>
				<Table.Head>Email</Table.Head>
				<Table.Head>Role</Table.Head>
				<Table.Head>Joined</Table.Head>
				<Table.Head class="w-10"><span class="sr-only">Actions</span></Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each members as m (m.id)}
				{@const isSelf = m.userId === currentUserId}
				{@const editable = canManage && !isSelf && m.role !== 'owner'}
				{@const shownRole = pending?.memberId === m.id ? pending.role : m.role}
				<Table.Row>
					<Table.Cell class="font-medium">
						{m.name}
						{#if isSelf}<span class="text-xs text-muted-foreground">(you)</span>{/if}
					</Table.Cell>
					<Table.Cell class="text-muted-foreground">{m.email}</Table.Cell>
					<Table.Cell>
						{#if editable}
							<!-- The getter always reads the stored role, so a cancelled
							     confirmation or a failed save snaps the select back. -->
							<Select.Root
								type="single"
								bind:value={() => shownRole, (v) => requestRole(m, v)}
								disabled={pending !== null}
							>
								<Select.Trigger class="h-8 w-28" aria-label={`Role of ${m.name}`}>
									{roleLabel(shownRole)}
								</Select.Trigger>
								<Select.Content>
									{#each roleOptions as o (o.value)}
										<Select.Item value={o.value} label={o.label}>{o.label}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						{:else}
							<Badge variant={roleVariant(m.role)}>{m.role}</Badge>
						{/if}
					</Table.Cell>
					<Table.Cell class="text-muted-foreground">{formatDateTime(m.createdAt)}</Table.Cell>
					<Table.Cell>
						{#if editable}
							<ConfirmAction
								action="?/remove"
								title={`Remove ${m.name}?`}
								description="They immediately lose access to this workspace. You can re-invite them later."
								actionLabel="Remove member"
							>
								{#snippet trigger({ props })}
									<Button
										{...props}
										variant="ghost"
										size="icon"
										class="size-8 text-muted-foreground hover:text-destructive"
										title="Remove member"
										aria-label={`Remove ${m.name}`}
									>
										<Trash2 class="size-4" />
									</Button>
								{/snippet}
								{#snippet fields()}
									<input type="hidden" name="memberIdOrEmail" value={m.id} />
								{/snippet}
							</ConfirmAction>
						{/if}
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>
