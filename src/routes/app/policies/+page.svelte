<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import PageHeader from '$lib/components/page-header.svelte';
	import PageShell from '$lib/components/page-shell.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import type { PolicyFormValues } from '$lib/features/policies/components/policy-form.svelte';
	import { inlineLimitsFromRow } from '$lib/features/policies/inline-limits';
	import { can } from '$lib/permissions';
	import ShieldHalf from '@lucide/svelte/icons/shield-half';
	import CreatePolicyDialog from './create-policy-dialog.svelte';
	import EditPolicyDialog from './edit-policy-dialog.svelte';
	import PolicyCard from './policy-card.svelte';

	let { data, form } = $props();
	let open = $state(false);
	let editing = $state<PolicyFormValues | null>(null);

	const canManage = $derived(can(data.role, 'policies:manage', data.memberPermissions));

	$effect(() => {
		if (form?.success) {
			open = false;
			editing = null;
			invalidateAll();
		}
	});
</script>

<PageShell width="default">
	<PageHeader title="Presets">
		{#snippet description()}
			Reusable limit & access baselines. Attach one to a service or token, then override individual
			fields inline. Empty lists mean "allow all".
		{/snippet}
		{#snippet action()}
			{#if canManage}
				<CreatePolicyDialog bind:open providers={data.providers} />
			{/if}
		{/snippet}
	</PageHeader>

	{#if data.policies.length === 0}
		<EmptyState
			icon={ShieldHalf}
			title="No presets yet"
			description="Presets are optional — you can set limits directly on a service or token. Create one to reuse a baseline across many."
		/>
	{:else}
		<div class="grid gap-4 sm:grid-cols-2">
			{#each data.policies as p (p.id)}
				<PolicyCard
					policy={p}
					{canManage}
					onEdit={() =>
						(editing = {
							id: p.id,
							name: p.name,
							...inlineLimitsFromRow(p),
							// a preset's rate limit is always set (0 = unlimited)
							rateLimitPerMinute: p.rateLimitPerMinute
						})}
				/>
			{/each}
		</div>
	{/if}
</PageShell>

<EditPolicyDialog {editing} providers={data.providers} onClose={() => (editing = null)} />
