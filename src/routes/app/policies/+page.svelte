<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import PageHeader from '$lib/components/layout/page-header.svelte';
	import PageShell from '$lib/components/layout/page-shell.svelte';
	import EmptyState from '$lib/components/layout/empty-state.svelte';
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
	const editingUsage = $derived(
		data.policies.find((p) => p.id === editing?.id)?.usage ?? { services: 0, tokens: 0 }
	);

	const SUCCESS = { create: 'Preset created', update: 'Preset saved', delete: 'Preset deleted' };

	// An error belongs inline in the dialog that submitted it while that dialog
	// is open; anything else (a failed delete) is a toast. Kept apart from `form`
	// so reopening a dialog doesn't show the previous attempt's error.
	let dialogError = $state<{ action: 'create' | 'update'; message: string } | null>(null);
	const errorFor = (action: 'create' | 'update') =>
		dialogError?.action === action ? dialogError.message : undefined;

	$effect(() => {
		void open;
		void editing?.id;
		untrack(() => (dialogError = null));
	});

	$effect(() => {
		const f = form;
		if (!f) return;
		untrack(() => {
			if ('success' in f) {
				if (f.action === 'create') open = false;
				if (f.action === 'update') editing = null;
				toast.success(SUCCESS[f.action]);
				if ('warning' in f && f.warning) toast.warning(f.warning);
				return;
			}
			const inDialog = (f.action === 'create' && open) || (f.action === 'update' && editing);
			if (inDialog) dialogError = { action: f.action, message: f.message };
			else toast.error(f.message);
		});
	});
</script>

<PageShell width="default">
	<PageHeader title="Presets">
		{#snippet description()}
			Reusable limits and access rules. Attach a preset on a service or token; those can override
			the numbers and narrow the lists.
		{/snippet}
		{#snippet action()}
			{#if canManage}
				<CreatePolicyDialog
					bind:open
					providers={data.providers}
					modelSuggestions={data.modelSuggestions}
					message={errorFor('create')}
				/>
			{/if}
		{/snippet}
	</PageHeader>

	{#if data.policies.length === 0}
		<EmptyState
			icon={ShieldHalf}
			title="No presets yet"
			description="Presets are optional — you can set limits directly on a service or token. Create one to reuse the same limits across many."
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

<EditPolicyDialog
	{editing}
	usage={editingUsage}
	providers={data.providers}
	modelSuggestions={data.modelSuggestions}
	message={errorFor('update')}
	onClose={() => (editing = null)}
/>
