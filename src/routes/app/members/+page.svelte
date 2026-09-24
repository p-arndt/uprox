<script lang="ts">
	import { toast } from 'svelte-sonner';
	import PageHeader from '$lib/components/layout/page-header.svelte';
	import PageShell from '$lib/components/layout/page-shell.svelte';
	import EmptyState from '$lib/components/layout/empty-state.svelte';
	import { can } from '$lib/permissions';
	import Users from '@lucide/svelte/icons/users';
	import InviteMemberDialog from './invite-member-dialog.svelte';
	import MembersTable from './members-table.svelte';
	import InvitationsTable from './invitations-table.svelte';
	import RoleLegend from './role-legend.svelte';

	let { data, form } = $props();
	let inviteOpen = $state(false);

	const canManage = $derived(can(data.role, 'members:manage', data.memberPermissions));
	const canManageSettings = $derived(can(data.role, 'settings:manage', data.memberPermissions));

	// Only the confirm-dialog actions report here; the invite dialog and the
	// role select handle their own results.
	$effect(() => {
		if (form?.action !== 'remove' && form?.action !== 'revokeInvite') return;
		if (!form.success) {
			toast.error(form.message ?? 'Something went wrong');
		} else if (form.action === 'remove') {
			toast.success(form.name ? `Removed ${form.name}` : 'Member removed');
		} else {
			toast.success('Invitation revoked');
		}
	});
</script>

<PageShell width="default">
	<PageHeader title="Members" description="People with access to this workspace and their roles.">
		{#snippet action()}
			{#if canManage}
				<InviteMemberDialog bind:open={inviteOpen} />
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

	<RoleLegend memberPermissions={data.memberPermissions} {canManageSettings} />
</PageShell>
