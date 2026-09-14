<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import ConfirmAction from '$lib/components/form/confirm-action.svelte';
	import { formatDateTime } from '$lib/format';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import type { PageData } from './$types';
	import { roleLabel, roleOptions, roleVariant } from './member-roles';

	// Workspace members with inline role changes and removal.

	let {
		members,
		currentUserId,
		canManage
	}: {
		members: PageData['members'];
		currentUserId: string;
		canManage: boolean;
	} = $props();

	// The inline role select writes the new value into its hidden field, then
	// submits the row form to persist the change.
	const roleForms: Record<string, HTMLFormElement> = {};
	function submitRole(memberId: string, role: string) {
		const form = roleForms[memberId];
		if (!form) return;
		(form.elements.namedItem('role') as HTMLInputElement).value = role;
		form.requestSubmit();
	}
</script>

<div class="rounded-xl border">
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>Name</Table.Head>
				<Table.Head>Email</Table.Head>
				<Table.Head>Role</Table.Head>
				<Table.Head>Joined</Table.Head>
				<Table.Head class="w-10"></Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each members as m (m.id)}
				{@const isSelf = m.userId === currentUserId}
				{@const editable = canManage && !isSelf && m.role !== 'owner'}
				<Table.Row>
					<Table.Cell class="font-medium">
						{m.name}
						{#if isSelf}<span class="text-xs text-muted-foreground">(you)</span>{/if}
					</Table.Cell>
					<Table.Cell class="text-muted-foreground">{m.email}</Table.Cell>
					<Table.Cell>
						{#if editable}
							<form
								method="post"
								action="?/changeRole"
								bind:this={roleForms[m.id]}
								use:enhance={() =>
									async ({ update }) =>
										update()}
							>
								<input type="hidden" name="memberId" value={m.id} />
								<input type="hidden" name="role" value={m.role} />
								<Select.Root
									type="single"
									value={m.role}
									onValueChange={(v) => submitRole(m.id, v)}
								>
									<Select.Trigger class="h-8 w-28">{roleLabel(m.role)}</Select.Trigger>
									<Select.Content>
										{#each roleOptions as o (o.value)}
											<Select.Item value={o.value} label={o.label}>{o.label}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</form>
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
