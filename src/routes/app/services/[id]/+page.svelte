<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import UsageWorkbench from '$lib/features/usage/components/usage-workbench.svelte';
	import { createUsageView } from '$lib/features/usage/view.svelte';
	import { NULL_VALUE, type UsageDimension } from '$lib/features/usage/group';
	import type { DimensionUsageRow } from '$lib/features/usage/types';
	import { inlineLimitsFromRow } from '$lib/features/policies/inline-limits';
	import { tokenStatus } from '$lib/features/tokens/tokens';
	import { formatDateTime, relativeTime } from '$lib/format';
	import { can } from '$lib/permissions';
	import ConfirmAction from '$lib/components/form/confirm-action.svelte';
	import DetailHeader from '$lib/components/layout/detail-header.svelte';
	import PageShell from '$lib/components/layout/page-shell.svelte';
	import ServiceForm, { type ServiceFormValues } from '../service-form.svelte';
	import { deleteServiceDescription } from '../service-display';
	import EffectiveConfigSummary from '$lib/features/policies/components/effective-config-summary.svelte';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	let { data, form } = $props();
	let editOpen = $state(false);

	const view = createUsageView({
		data: () => data,
		basePath: () => resolve('/app/services/[id]', { id: data.service.id })
	});

	const canManage = $derived(can(data.role, 'services:manage', data.memberPermissions));
	const canIssueTokens = $derived(can(data.role, 'tokens:manage', data.memberPermissions));
	const activeTokenCount = $derived(
		data.tokens.filter((t) => tokenStatus(t).label === 'active').length
	);
	const issueTokenHref = $derived(
		`${resolve('/app/tokens')}?service=${encodeURIComponent(data.service.id)}`
	);

	// Rebuilt on each open so the form starts from the saved state, not from a
	// previous, cancelled edit.
	const editValues = $derived<ServiceFormValues>({
		id: data.service.id,
		name: data.service.name,
		type: data.service.type,
		description: data.service.description ?? '',
		policyId: data.service.policyId ?? '',
		providerSecretId: data.service.providerSecretId ?? '',
		...inlineLimitsFromRow(data.service)
	});

	$effect(() => {
		if (form?.success) {
			editOpen = false;
			invalidateAll();
		}
	});
</script>

{#snippet rowLabel(row: DimensionUsageRow, dim: UsageDimension)}
	{#if dim === 'token' && row.key !== NULL_VALUE}
		<a
			href={resolve('/app/tokens/[id]', { id: row.key })}
			class="truncate font-medium hover:underline"
			title={row.label}
		>
			{row.label}
		</a>
	{:else if dim === 'model'}
		<span class="truncate font-mono text-[13px] font-medium" title={row.label}>{row.label}</span>
	{:else}
		<span class="truncate font-medium" title={row.label}>{row.label}</span>
	{/if}
{/snippet}

<PageShell width="wide">
	<DetailHeader icon={Boxes} eyebrow="Service" title={data.service.name}>
		{#snippet badges()}
			<Badge variant="outline">{data.service.type}</Badge>
		{/snippet}
		{#snippet lede()}
			{#if data.service.description}
				<p class="text-sm text-muted-foreground">{data.service.description}</p>
			{/if}
		{/snippet}
		{#snippet meta()}
			Preset: {data.service.policyName ?? 'None'} · created {relativeTime(data.service.createdAt)}
		{/snippet}
		{#snippet action()}
			{#if canManage}
				<div class="flex items-center gap-2">
					<Button variant="outline" onclick={() => (editOpen = true)}>
						<Pencil class="size-4" /> Edit
					</Button>
					<ConfirmAction
						action="?/delete"
						title={`Delete “${data.service.name}”?`}
						description={deleteServiceDescription(activeTokenCount)}
						actionLabel="Delete service"
					>
						{#snippet trigger({ props })}
							<Button
								{...props}
								variant="outline"
								class="text-muted-foreground hover:text-destructive"
							>
								<Trash2 class="size-4" /> Delete
							</Button>
						{/snippet}
					</ConfirmAction>
				</div>
			{/if}
		{/snippet}
	</DetailHeader>

	<Card.Root>
		<Card.Header>
			<Card.Title>Tokens</Card.Title>
			<Card.Description>
				{activeTokenCount} active of {data.tokens.length} issued to this service.
			</Card.Description>
			{#if canIssueTokens}
				<Card.Action>
					<Button href={issueTokenHref} size="sm"><Plus class="size-4" /> Issue token</Button>
				</Card.Action>
			{/if}
		</Card.Header>
		<Card.Content>
			{#if data.tokens.length === 0}
				<p class="text-sm text-muted-foreground">No tokens have been issued to this service yet.</p>
			{:else}
				<div class="rounded-xl border">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Name</Table.Head>
								<Table.Head>Token</Table.Head>
								<Table.Head>Status</Table.Head>
								<Table.Head>Last used</Table.Head>
								<Table.Head>Expires</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each data.tokens as t (t.id)}
								{@const st = tokenStatus(t)}
								<Table.Row class="transition-colors hover:bg-accent/40">
									<Table.Cell class="font-medium">
										<a href={resolve('/app/tokens/[id]', { id: t.id })} class="hover:underline">
											{t.name}
										</a>
									</Table.Cell>
									<Table.Cell>
										<span
											title="Token prefix (the full token is shown only once at creation)"
											class="inline-flex items-center rounded-md bg-muted/60 px-2 py-1 font-mono text-xs text-muted-foreground"
										>
											{t.display}
										</span>
									</Table.Cell>
									<Table.Cell>
										<span class="inline-flex items-center gap-1.5 text-sm capitalize">
											<span class="size-1.5 rounded-full {st.dot} {st.pulse ? 'dot-pulse' : ''}"
											></span>
											{st.label}
										</span>
									</Table.Cell>
									<Table.Cell class="text-muted-foreground">
										{t.lastUsedAt ? relativeTime(t.lastUsedAt) : 'Never'}
									</Table.Cell>
									<Table.Cell class="text-muted-foreground">
										{t.expiresAt ? formatDateTime(t.expiresAt) : 'Never'}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Effective settings</Card.Title>
			<Card.Description>
				What applies to this service's tokens before any per-token overrides, and where each value
				comes from.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-3">
			<EffectiveConfigSummary
				config={data.effectiveConfig}
				subject="service"
				serviceName={data.service.name}
				providerLabels={data.providerLabels}
			/>
			<p class="text-sm text-muted-foreground">
				Upstream key: {data.service.upstreamKeyLabel ?? 'Automatic (default key)'}
			</p>
		</Card.Content>
	</Card.Root>

	<UsageWorkbench
		analysis={data}
		{view}
		{rowLabel}
		budgets={data.budget}
		budgetThreshold={data.budgetThreshold}
	/>
</PageShell>

{#if canManage}
	<Dialog.Root bind:open={editOpen}>
		<Dialog.Content class="max-h-[88vh] overflow-y-auto sm:max-w-lg">
			<Dialog.Header>
				<Dialog.Title>Edit service</Dialog.Title>
				<Dialog.Description>Update this machine identity.</Dialog.Description>
			</Dialog.Header>
			{#if editOpen}
				<ServiceForm
					action="?/update"
					submitLabel="Save changes"
					idPrefix="svc-detail-edit"
					values={editValues}
					policies={data.policies}
					providers={data.providers}
					secretOptions={data.providerSecrets}
				/>
			{/if}
		</Dialog.Content>
	</Dialog.Root>
{/if}
