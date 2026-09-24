<script lang="ts">
	import { untrack } from 'svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import EffectiveConfigSummary from '$lib/features/policies/components/effective-config-summary.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import UsageWorkbench from '$lib/features/usage/components/usage-workbench.svelte';
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import { createUsageView } from '$lib/features/usage/view.svelte';
	import type { UsageDimension } from '$lib/features/usage/group';
	import type { DimensionUsageRow } from '$lib/features/usage/types';
	import { toast } from 'svelte-sonner';
	import { formatDateTime, relativeTime } from '$lib/format';
	import { can } from '$lib/permissions';
	import { scopeBadges } from '$lib/scopes';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import DetailHeader from '$lib/components/layout/detail-header.svelte';
	import Eye from '@lucide/svelte/icons/eye';
	import PageShell from '$lib/components/layout/page-shell.svelte';
	import EditTokenDialog, {
		type EditTokenValues
	} from '$lib/features/tokens/components/edit-token-dialog.svelte';
	import SecretDialog from '$lib/features/tokens/components/secret-dialog.svelte';
	import TokenConfirmDialog from '$lib/features/tokens/components/token-confirm-dialog.svelte';
	import { tokenStatus as statusOf, type RevealedSecret } from '$lib/features/tokens/tokens';
	import { actionToast, dialogMessage } from '$lib/features/tokens/action-feedback';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Ban from '@lucide/svelte/icons/ban';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import CircleOff from '@lucide/svelte/icons/circle-off';

	let { data, form } = $props();

	const view = createUsageView({
		data: () => data,
		basePath: () => resolve('/app/tokens/[id]', { id: data.token.id })
	});

	const canManage = $derived(can(data.role, 'tokens:manage', data.memberPermissions));

	// Holds the revealed secret for the copy dialog (re-copyable tokens only).
	let secret = $state<RevealedSecret | null>(null);
	let editing = $state<EditTokenValues | null>(null);
	let revealing = $state(false);
	let revokeOpen = $state(false);
	let deleteOpen = $state(false);

	$effect(() => {
		const result = form;
		untrack(() => {
			const t = actionToast(result, editing ? 'update' : null);
			if (t) toast[t.kind](t.message);
			if (result?.revealed) secret = { ...result.revealed, recopyable: true };
			if (result?.action === 'update' && result.success) editing = null;
		});
	});

	function startEdit() {
		const t = data.token;
		editing = {
			id: t.id,
			name: t.name,
			serviceId: t.serviceId,
			scopes: [...t.scopes],
			policyId: t.policyId ?? '',
			...data.inlineLimits,
			expiresAt: t.expiresAt,
			recopyable: t.recopyable
		};
	}

	const tokenStatus = $derived(statusOf(data.token));

	const expiryLabel = $derived.by(() => {
		const at = data.token.expiresAt;
		if (!at) return 'never expires';
		return `${new Date(at).getTime() < Date.now() ? 'expired' : 'expires'} ${formatDateTime(at)}`;
	});
</script>

{#snippet rowLabel(row: DimensionUsageRow, dim: UsageDimension)}
	{#if dim === 'model'}
		<span class="truncate font-mono text-[13px] font-medium" title={row.label}>{row.label}</span>
	{:else}
		<span class="truncate font-medium" title={row.label}>{row.label}</span>
	{/if}
{/snippet}

<PageShell width="wide">
	<DetailHeader icon={KeyRound} eyebrow="Machine token" title={data.token.name}>
		{#snippet badges()}
			<span class="inline-flex items-center gap-1.5 text-sm text-muted-foreground capitalize">
				<span class="size-1.5 rounded-full {tokenStatus.dot} {tokenStatus.pulse ? 'dot-pulse' : ''}"
				></span>
				{tokenStatus.label}
			</span>
			<span
				title="Token prefix (the full token is shown only once at creation)"
				class="inline-flex items-center rounded-md bg-muted/60 px-2 py-0.5 font-mono text-xs text-muted-foreground"
			>
				{data.token.display}
			</span>
			{#if data.token.recopyable && !data.token.revokedAt && canManage}
				<form
					method="post"
					action="?/reveal"
					use:enhance={() => {
						revealing = true;
						return async ({ update }) => {
							try {
								await update({ reset: false });
							} finally {
								revealing = false;
							}
						};
					}}
				>
					<Button
						type="submit"
						variant="outline"
						size="sm"
						class="h-7 gap-1.5 text-xs"
						disabled={revealing}
					>
						<Eye class="size-3.5" />
						{revealing ? 'Revealing…' : 'Reveal'}
					</Button>
				</form>
			{/if}
		{/snippet}
		{#snippet meta()}
			Service:
			<a
				href={resolve('/app/services/[id]', { id: data.token.serviceId })}
				class="font-medium hover:underline"
			>
				{data.token.serviceName}
			</a>
			· Preset: {data.token.policyId
				? (data.token.policyName ?? 'none')
				: `inherits service preset (${data.token.servicePresetName ?? 'none'})`} · created {relativeTime(
				data.token.createdAt
			)} · last used {relativeTime(data.token.lastUsedAt)} · {expiryLabel}
		{/snippet}
		{#snippet action()}
			{#if canManage}
				<div class="flex items-center gap-2">
					{#if !data.token.revokedAt}
						<Button variant="outline" onclick={startEdit}>
							<Pencil class="size-4" /> Edit
						</Button>
						<Button
							variant="outline"
							class="text-muted-foreground hover:text-destructive"
							onclick={() => (revokeOpen = true)}
						>
							<Ban class="size-4" /> Revoke
						</Button>
					{/if}
					<Button
						variant="outline"
						class="text-muted-foreground hover:text-destructive"
						onclick={() => (deleteOpen = true)}
					>
						<Trash2 class="size-4" /> Delete
					</Button>
				</div>
			{/if}
		{/snippet}
		{#snippet extra()}
			<div class="flex flex-wrap items-center gap-1 pt-0.5">
				<span class="mr-1 text-xs text-muted-foreground">Endpoint access:</span>
				{#each scopeBadges(data.token.scopes) as s (s)}<Badge variant="outline">{s}</Badge>{/each}
			</div>
		{/snippet}
	</DetailHeader>

	{#if data.token.revokedAt}
		<Alert.Root variant="destructive">
			<CircleOff />
			<Alert.Title>
				Revoked {formatDateTime(data.token.revokedAt)}. This token can no longer authenticate.
			</Alert.Title>
		</Alert.Root>
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Effective settings</Card.Title>
			<Card.Description>
				What applies to this token after combining token, presets, service and instance defaults.
				All budgets that are set apply at once.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<EffectiveConfigSummary
				config={data.effectiveConfig}
				subject="token"
				serviceName={data.token.serviceName}
				providerLabels={data.providerLabels}
			/>
		</Card.Content>
	</Card.Root>

	<UsageWorkbench analysis={data} {view} {rowLabel} />
</PageShell>

<EditTokenDialog
	{editing}
	onClose={() => (editing = null)}
	policies={data.policies}
	providers={data.providers}
	services={data.services}
	canCreateService={can(data.role, 'services:manage', data.memberPermissions)}
	defaults={data.defaults}
	message={dialogMessage(form, 'update')}
/>

<SecretDialog {secret} onClose={() => (secret = null)} />

{#if canManage}
	<TokenConfirmDialog
		bind:open={revokeOpen}
		action="?/revoke"
		title={`Revoke “${data.token.name}”?`}
		description="Any service still using this token will immediately fail to authenticate. This can't be undone."
		actionLabel="Revoke token"
		pendingLabel="Revoking…"
	/>
	<TokenConfirmDialog
		bind:open={deleteOpen}
		action="?/delete"
		title={`Delete “${data.token.name}”?`}
		description="This permanently removes the token and its configuration. Audit-log history is kept but no longer linked to this token. This can't be undone."
		actionLabel="Delete token"
		pendingLabel="Deleting…"
	/>
{/if}
