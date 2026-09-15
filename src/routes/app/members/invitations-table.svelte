<script lang="ts">
	import { toast } from 'svelte-sonner';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import ConfirmAction from '$lib/components/form/confirm-action.svelte';
	import { formatDateTime } from '$lib/format';
	import Copy from '@lucide/svelte/icons/copy';
	import Ban from '@lucide/svelte/icons/ban';
	import Mail from '@lucide/svelte/icons/mail';
	import type { PageData } from './$types';
	import { roleVariant } from './member-roles';

	// Pending invitations with copy-link and revoke actions.

	let {
		invitations,
		inviteBaseUrl,
		canManage
	}: {
		invitations: PageData['invitations'];
		/** origin the /invite/[id] links are built on */
		inviteBaseUrl: string;
		canManage: boolean;
	} = $props();

	async function copyInvite(id: string) {
		await navigator.clipboard.writeText(`${inviteBaseUrl}/invite/${id}`);
		toast.success('Invite link copied to clipboard');
	}
</script>

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
				{#each invitations as inv (inv.id)}
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
									<ConfirmAction
										action="?/revokeInvite"
										title="Revoke invitation?"
										description={`The invite link for ${inv.email} stops working. You can send a new one anytime.`}
										actionLabel="Revoke invite"
									>
										{#snippet trigger({ props })}
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
										{#snippet fields()}
											<input type="hidden" name="invitationId" value={inv.id} />
										{/snippet}
									</ConfirmAction>
								{/if}
							</div>
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</div>
