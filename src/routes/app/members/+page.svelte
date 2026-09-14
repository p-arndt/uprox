<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import PageHeader from '$lib/components/page-header.svelte';
	import PageShell from '$lib/components/page-shell.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import { can } from '$lib/permissions';
	import Users from '@lucide/svelte/icons/users';
	import InviteMemberDialog from './invite-member-dialog.svelte';
	import MembersTable from './members-table.svelte';
	import InvitationsTable from './invitations-table.svelte';

	let { data, form } = $props();
	let inviteOpen = $state(false);

	const canManage = $derived(can(data.role, 'members:manage', data.memberPermissions));

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
</script>

<PageShell width="default">
	<PageHeader title="Members" description="People with access to this workspace and their roles.">
		{#snippet action()}
			{#if canManage}
				<InviteMemberDialog bind:open={inviteOpen} message={form?.message} />
			{/if}
		{/snippet}
	</PageHeader>

	{#if data.members.length === 0}
		<EmptyState icon={Users} title="No members yet" />
	{:else}
		<MembersTable members={data.members} currentUserId={data.currentUserId} {canManage} />
	{/if}

	{#if data.invitations.length > 0}
		<InvitationsTable
			invitations={data.invitations}
			inviteBaseUrl={data.inviteBaseUrl}
			{canManage}
		/>
	{/if}
</PageShell>
