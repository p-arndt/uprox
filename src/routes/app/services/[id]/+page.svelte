<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
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
	import {
		actionError,
		deleteServiceDescription,
		partitionTokens,
		serviceTypeLabel,
		SUCCESS_MESSAGES,
		type ActionResult
	} from '../service-display';
	import EffectiveConfigSummary from '$lib/features/policies/components/effective-config-summary.svelte';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	let { data, form } = $props();
	let editOpen = $state(false);
	let showInactive = $state(false);
	// The result whose dialog the user closed; keeps its error from reappearing on reopen.
	let dismissed = $state<ActionResult | null>(null);
	const updateError = $derived(actionError(form, 'update', dismissed));

	const view = createUsageView({
		data: () => data,
		basePath: () => resolve('/app/services/[id]', { id: data.service.id })
	});

	const canManage = $derived(can(data.role, 'services:manage', data.memberPermissions));
	const canIssueTokens = $derived(can(data.role, 'tokens:manage', data.memberPermissions));
	const tokenParts = $derived(partitionTokens(data.tokens));
	const activeTokenCount = $derived(tokenParts.active.length);
	const visibleTokens = $derived(
		showInactive ? [...tokenParts.active, ...tokenParts.inactive] : tokenParts.active
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

	// Update errors render in the edit dialog; delete redirects on success, so
	// only its failure lands here, with no dialog left to show it in.
	$effect(() => {
		if (!form) return;
		if (form.success) {
			editOpen = false;
			toast.success(SUCCESS_MESSAGES[form.action] ?? 'Done');
			invalidateAll();
		} else if (form.message && form.action === 'delete') {
			toast.error(form.message);
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
			<Badge variant="outline">{serviceTypeLabel(data.service.type)}</Badge>
		{/snippet}
		{#snippet lede()}
			{#if data.service.description}
				<p class="text-sm text-muted-foreground">{data.service.description}</p>
			{/if}
		{/snippet}
		{#snippet meta()}
			Preset:
			{#if data.service.policyName}
				<a href={resolve('/app/policies')} class="hover:text-foreground hover:underline">
					{data.service.policyName}
				</a>
			{:else}
				None
			{/if}
			· created {relativeTime(data.service.createdAt)}
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
						description={deleteServiceDescription(activeTokenCount, data.service.name)}
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
				<div
					class="flex flex-col items-center gap-3 rounded-xl border border-dashed py-8 text-center"
				>
					<p class="text-sm text-muted-foreground">
						No tokens have been issued to this service yet.
					</p>
					{#if canIssueTokens}
						<Button href={issueTokenHref} size="sm"><Plus class="size-4" /> Issue token</Button>
					{:else}
						<p class="text-sm text-muted-foreground">Ask an admin to issue one.</p>
					{/if}
				</div>
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
							{#each visibleTokens as t (t.id)}
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
				{#if tokenParts.inactive.length > 0}
					<Button
						variant="ghost"
						size="sm"
						class="mt-2 text-muted-foreground"
						aria-expanded={showInactive}
						onclick={() => (showInactive = !showInactive)}
					>
						{showInactive
							? 'Hide inactive'
							: `Show ${tokenParts.inactive.length} inactive (revoked or expired)`}
					</Button>
				{/if}
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
		<Card.Content>
			<EffectiveConfigSummary
				config={data.effectiveConfig}
				subject="service"
				serviceName={data.service.name}
				providerLabels={data.providerLabels}
			/>
			<!-- same row markup as EffectiveConfigSummary, so the key reads as one more setting -->
			<dl class="mt-2.5 border-t pt-2.5 text-sm">
				<div class="grid gap-1 sm:grid-cols-[11rem_1fr] sm:gap-4">
					<dt class="text-muted-foreground">Upstream key</dt>
					<dd class="min-w-0">
						<div class="font-medium break-words">
							{data.service.upstreamKeyLabel ?? 'Automatic'}
						</div>
						<div class="text-xs text-muted-foreground">
							{data.service.upstreamKeyLabel
								? 'Pinned on this service'
								: "Each provider's default key"}
						</div>
					</dd>
				</div>
			</dl>
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
	<Dialog.Root
		bind:open={editOpen}
		onOpenChange={(v) => {
			if (!v) dismissed = form ?? null;
		}}
	>
		<Dialog.Content class="max-h-[88vh] overflow-y-auto sm:max-w-lg">
			<Dialog.Header>
				<Dialog.Title>Edit service</Dialog.Title>
				<Dialog.Description
					>Changes apply immediately to all tokens in this service.</Dialog.Description
				>
			</Dialog.Header>
			{#if editOpen}
				<ServiceForm
					defaults={data.defaults}
					modelSuggestions={data.modelSuggestions}
					action="?/update"
					submitLabel="Save changes"
					idPrefix="svc-detail-edit"
					values={editValues}
					policies={data.policies}
					providers={data.providers}
					secretOptions={data.providerSecrets}
					message={updateError}
				/>
			{/if}
		</Dialog.Content>
	</Dialog.Root>
{/if}
