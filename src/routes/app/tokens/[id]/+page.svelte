<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
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
	import KeyRound from '@lucide/svelte/icons/key-round';
	import DetailHeader from '$lib/components/layout/detail-header.svelte';
	import Eye from '@lucide/svelte/icons/eye';
	import Copy from '@lucide/svelte/icons/copy';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import PageShell from '$lib/components/layout/page-shell.svelte';
	import ConfirmAction from '$lib/components/form/confirm-action.svelte';
	import EditTokenDialog, {
		type EditTokenValues
	} from '$lib/features/tokens/components/edit-token-dialog.svelte';
	import { tokenStatus as statusOf } from '$lib/features/tokens/tokens';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Ban from '@lucide/svelte/icons/ban';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	let { data, form } = $props();

	const view = createUsageView({
		data: () => data,
		basePath: () => resolve('/app/tokens/[id]', { id: data.token.id })
	});

	const canManage = $derived(can(data.role, 'tokens:manage', data.memberPermissions));

	// Holds the revealed secret for the copy dialog (re-copyable tokens only).
	let secret = $state<{ name: string; plaintext: string } | null>(null);
	let editing = $state<EditTokenValues | null>(null);
	$effect(() => {
		if (form?.revealed) secret = form.revealed;
		if (form?.success) editing = null;
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
	async function copy(text: string, msg = 'Copied to clipboard') {
		await navigator.clipboard.writeText(text);
		toast.success(msg);
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
			{#if data.token.recopyable && canManage}
				<form
					method="post"
					action="?/reveal"
					use:enhance={() =>
						async ({ update }) =>
							update({ reset: false })}
				>
					<Button type="submit" variant="outline" size="sm" class="h-7 gap-1.5 text-xs">
						<Eye class="size-3.5" /> Reveal
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
						<ConfirmAction
							action="?/revoke"
							title={`Revoke “${data.token.name}”?`}
							description="Any service still using this token will immediately fail to authenticate. This can't be undone."
							actionLabel="Revoke token"
						>
							{#snippet trigger({ props })}
								<Button
									{...props}
									variant="outline"
									class="text-muted-foreground hover:text-destructive"
								>
									<Ban class="size-4" /> Revoke
								</Button>
							{/snippet}
						</ConfirmAction>
					{/if}
					<ConfirmAction
						action="?/delete"
						title={`Delete “${data.token.name}”?`}
						description="This permanently removes the token and its configuration. Audit-log history is kept but no longer linked to this token. This can't be undone."
						actionLabel="Delete token"
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
		{#snippet extra()}
			<div class="flex flex-wrap gap-1 pt-0.5">
				{#each data.token.scopes as s (s)}<Badge variant="outline">{s}</Badge>{:else}<Badge
						variant="outline">All endpoints</Badge
					>{/each}
			</div>
		{/snippet}
	</DetailHeader>

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
	message={form?.action === 'update' ? form.message : undefined}
/>

<!-- re-copy reveal: shows the stored secret again for a re-copyable token -->
<Dialog.Root
	open={secret !== null}
	onOpenChange={(v) => {
		if (!v) secret = null;
	}}
>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Token secret</Dialog.Title>
			<Dialog.Description>
				The full secret for <span class="font-medium text-foreground">{secret?.name}</span>. You can
				reveal it again any time from this page.
			</Dialog.Description>
		</Dialog.Header>
		<div
			class="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
		>
			<TriangleAlert class="mt-0.5 size-4 shrink-0 text-amber-600" />
			<span>This token is stored encrypted so it can be re-copied. Keep it secret.</span>
		</div>
		<div class="relative min-w-0">
			<code class="block overflow-x-auto rounded-lg bg-muted py-2.5 pr-11 pl-3 text-xs"
				>{secret?.plaintext}</code
			>
			<Button
				size="icon"
				variant="ghost"
				class="absolute top-1/2 right-1.5 size-7 -translate-y-1/2"
				onclick={() => secret && copy(secret.plaintext, 'Token copied')}
				title="Copy token"
			>
				<Copy class="size-3.5" />
			</Button>
		</div>
		<Dialog.Footer>
			<Button onclick={() => (secret = null)}>Done</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
