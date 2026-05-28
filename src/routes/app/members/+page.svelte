<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
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
	let inviteRole = $state('member');

	const roleOptions = [
		{ value: 'member', label: 'Member' },
		{ value: 'admin', label: 'Admin' }
	];
	const roleLabel = (r: string) => roleOptions.find((o) => o.value === r)?.label ?? r;

	// The inline role select writes the new value into its hidden field, then
	// submits the row form to persist the change.
	function submitRole(formId: string, role: string) {
		const form = document.getElementById(formId) as HTMLFormElement | null;
		if (!form) return;
		(form.elements.namedItem('role') as HTMLInputElement).value = role;
		form.requestSubmit();
	}

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
				People with access to this workspace and their roles.
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
							<Input
								id="email"
								name="email"
								type="email"
								placeholder="person@example.com"
								required
							/>
						</div>
						<div class="space-y-2">
							<Label for="role">Role</Label>
							<Select.Root type="single" name="role" bind:value={inviteRole}>
								<Select.Trigger id="role" class="w-full">{roleLabel(inviteRole)}</Select.Trigger>
								<Select.Content>
									{#each roleOptions as o (o.value)}
										<Select.Item value={o.value} label={o.label}>{o.label}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
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
									id={`role-form-${m.id}`}
									use:enhance={() =>
										async ({ update }) =>
											update()}
								>
									<input type="hidden" name="memberId" value={m.id} />
									<input type="hidden" name="role" value={m.role} />
									<Select.Root
										type="single"
										value={m.role}
										onValueChange={(v) => submitRole(`role-form-${m.id}`, v)}
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
							{#if canManage && !isSelf && m.role !== 'owner'}
								<AlertDialog.Root>
									<AlertDialog.Trigger>
										{#snippet child({ props })}
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
									</AlertDialog.Trigger>
									<AlertDialog.Content>
										<AlertDialog.Header>
											<AlertDialog.Title>Remove {m.name}?</AlertDialog.Title>
											<AlertDialog.Description>
												They immediately lose access to this workspace. You can re-invite them
												later.
											</AlertDialog.Description>
										</AlertDialog.Header>
										<AlertDialog.Footer>
											<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
											<form
												method="post"
												action="?/remove"
												use:enhance={() =>
													async ({ update }) =>
														update()}
											>
												<input type="hidden" name="memberIdOrEmail" value={m.id} />
												<AlertDialog.Action type="submit" variant="destructive">
													Remove member
												</AlertDialog.Action>
											</form>
										</AlertDialog.Footer>
									</AlertDialog.Content>
								</AlertDialog.Root>
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
								<Table.Cell class="text-muted-foreground"
									>{formatDateTime(inv.expiresAt)}</Table.Cell
								>
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
											<AlertDialog.Root>
												<AlertDialog.Trigger>
													{#snippet child({ props })}
														<Button
															{...props}
															variant="ghost"
															size="icon"
															class="size-8 text-muted-foreground hover:text-destructive"
															title="Revoke invitation"
														>
															<Ban class="size-4" />
														</Button>
													{/snippet}
												</AlertDialog.Trigger>
												<AlertDialog.Content>
													<AlertDialog.Header>
														<AlertDialog.Title>Revoke invitation?</AlertDialog.Title>
														<AlertDialog.Description>
															The invite link for {inv.email} stops working. You can send a new one anytime.
														</AlertDialog.Description>
													</AlertDialog.Header>
													<AlertDialog.Footer>
														<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
														<form
															method="post"
															action="?/revokeInvite"
															use:enhance={() =>
																async ({ update }) =>
																	update()}
														>
															<input type="hidden" name="invitationId" value={inv.id} />
															<AlertDialog.Action type="submit" variant="destructive">
																Revoke invite
															</AlertDialog.Action>
														</form>
													</AlertDialog.Footer>
												</AlertDialog.Content>
											</AlertDialog.Root>
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
