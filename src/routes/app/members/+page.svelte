<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { NativeSelect } from '$lib/components/ui/native-select/index.js';
	import { can } from '$lib/permissions';
	import { formatDateTime } from '$lib/format';
	import Plus from '@lucide/svelte/icons/plus';
	import Users from '@lucide/svelte/icons/users';
	import Copy from '@lucide/svelte/icons/copy';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Ban from '@lucide/svelte/icons/ban';
	import Mail from '@lucide/svelte/icons/mail';

	let { data, form } = $props();
	let inviteOpen = $state(false);

	const canManage = $derived(can(data.role, 'members:manage', data.memberPermissions));

	function roleVariant(role: string): 'default' | 'secondary' | 'outline' {
		if (role === 'owner') return 'default';
		if (role === 'admin') return 'secondary';
		return 'outline';
	}

	// Surface action results: close the invite dialog and refresh on success,
	// show errors as toasts.
	$effect(() => {
		if (form?.invited) {
			toast.success('Invitation sent');
			inviteOpen = false;
			invalidateAll();
		} else if (form?.success) {
			toast.success('Done');
			invalidateAll();
		} else if (form?.message) {
			toast.error(form.message);
		}
	});

	async function copyInvite(id: string) {
		await navigator.clipboard.writeText(`${data.inviteBaseUrl}/invite/${id}`);
		toast.success('Invite link copied to clipboard');
	}
</script>

<div class="mx-auto max-w-5xl space-y-6">
	<div class="flex items-start justify-between gap-4">
		<div>
			<h2 class="text-xl font-semibold tracking-tight">Members</h2>
			<p class="text-sm text-muted-foreground">
				People who belong to this organization and their roles.
			</p>
		</div>
		{#if canManage}
			<Dialog.Root bind:open={inviteOpen}>
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
							We'll email an invite. If email isn't configured, copy the invite link from the
							pending list below.
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
							<NativeSelect id="role" name="role" class="w-full">
								<option value="member">Member</option>
								<option value="admin">Admin</option>
							</NativeSelect>
						</div>
						{#if form?.message}
							<p class="text-sm text-destructive">{form.message}</p>
						{/if}
						<Dialog.Footer>
							<Button type="submit">Send invitation</Button>
						</Dialog.Footer>
					</form>
				</Dialog.Content>
			</Dialog.Root>
		{/if}
	</div>

	<!-- members -->
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
				{#each data.members as m (m.id)}
					{@const isSelf = m.userId === data.currentUserId}
					<Table.Row>
						<Table.Cell class="font-medium">
							{m.name}
							{#if isSelf}<span class="text-xs text-muted-foreground">(you)</span>{/if}
						</Table.Cell>
						<Table.Cell class="text-muted-foreground">{m.email}</Table.Cell>
						<Table.Cell>
							{#if canManage && !isSelf && m.role !== 'owner'}
								<form
									method="post"
									action="?/changeRole"
									use:enhance={() =>
										async ({ update }) =>
											update()}
								>
									<input type="hidden" name="memberId" value={m.id} />
									<NativeSelect
										name="role"
										value={m.role}
										class="h-8 w-28"
										onchange={(e) => e.currentTarget.form?.requestSubmit()}
									>
										<option value="member">Member</option>
										<option value="admin">Admin</option>
									</NativeSelect>
								</form>
							{:else}
								<Badge variant={roleVariant(m.role)}>{m.role}</Badge>
							{/if}
						</Table.Cell>
						<Table.Cell class="text-muted-foreground">{formatDateTime(m.createdAt)}</Table.Cell>
						<Table.Cell>
							{#if canManage && !isSelf && m.role !== 'owner'}
								<form
									method="post"
									action="?/remove"
									use:enhance={() =>
										async ({ update }) =>
											update()}
								>
									<input type="hidden" name="memberIdOrEmail" value={m.id} />
									<Button
										type="submit"
										variant="ghost"
										size="icon"
										class="size-8 text-muted-foreground hover:text-destructive"
										title="Remove member"
									>
										<Trash2 class="size-4" />
									</Button>
								</form>
							{/if}
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>

	<!-- pending invitations -->
	{#if data.invitations.length > 0}
		<div class="space-y-3">
			<div class="flex items-center gap-2">
				<Mail class="size-4 text-muted-foreground" />
				<h3 class="text-sm font-semibold tracking-tight">Pending invitations</h3>
			</div>
			<div class="rounded-xl border">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Email</Table.Head>
							<Table.Head>Role</Table.Head>
							<Table.Head>Expires</Table.Head>
							<Table.Head class="w-24"></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.invitations as inv (inv.id)}
							<Table.Row>
								<Table.Cell class="font-medium">{inv.email}</Table.Cell>
								<Table.Cell>
									<Badge variant={roleVariant(inv.role ?? 'member')}>{inv.role ?? 'member'}</Badge>
								</Table.Cell>
								<Table.Cell class="text-muted-foreground">{formatDateTime(inv.expiresAt)}</Table.Cell>
								<Table.Cell>
									<div class="flex items-center justify-end gap-1">
										<Button
											variant="ghost"
											size="icon"
											class="size-8 text-muted-foreground"
											title="Copy invite link"
											onclick={() => copyInvite(inv.id)}
										>
											<Copy class="size-4" />
										</Button>
										{#if canManage}
											<form
												method="post"
												action="?/revokeInvite"
												use:enhance={() =>
													async ({ update }) =>
														update()}
											>
												<input type="hidden" name="invitationId" value={inv.id} />
												<Button
													type="submit"
													variant="ghost"
													size="icon"
													class="size-8 text-muted-foreground hover:text-destructive"
													title="Revoke invitation"
												>
													<Ban class="size-4" />
												</Button>
											</form>
										{/if}
									</div>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		</div>
	{/if}

	{#if data.members.length === 0}
		<div class="flex flex-col items-center justify-center rounded-xl border border-dashed py-16">
			<Users class="size-8 text-muted-foreground" />
			<p class="mt-3 text-sm font-medium">No members yet</p>
		</div>
	{/if}
</div>
