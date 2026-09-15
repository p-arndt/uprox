<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import PageHeader from '$lib/components/layout/page-header.svelte';
	import EmptyState from '$lib/components/layout/empty-state.svelte';
	import StatCard from '$lib/components/layout/stat-card.svelte';
	import TokenRow from '$lib/features/tokens/components/token-row.svelte';
	import CreateTokenDialog from '$lib/features/tokens/components/create-token-dialog.svelte';
	import EditTokenDialog from '$lib/features/tokens/components/edit-token-dialog.svelte';
	import SecretDialog from '$lib/features/tokens/components/secret-dialog.svelte';
	import { type TokenFormValues } from '$lib/features/tokens/components/token-form.svelte';
	import { tokenStats, type RevealedSecret, type Token } from '$lib/features/tokens/tokens';
	import { inlineLimitsFromRow } from '$lib/features/policies/inline-limits';
	import { relativeTime } from '$lib/format';
	import { can } from '$lib/permissions';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import PageShell from '$lib/components/layout/page-shell.svelte';

	let { data, form } = $props();
	let createOpen = $state(false);
	// `recopyable` switches the dialog copy between "stored only as a hash, gone
	// forever" and "you can reveal this again later".
	let secret = $state<RevealedSecret | null>(null);
	let editing = $state<TokenFormValues | null>(null);

	const canManage = $derived(can(data.role, 'tokens:manage', data.memberPermissions));

	// Surface action results: a fresh secret from create is revealed once (and the
	// create dialog closes), a re-copy reveal shows the stored secret again, and a
	// successful update closes the edit dialog and refreshes the list.
	$effect(() => {
		if (form?.created) {
			secret = form.created;
			createOpen = false;
		}
		if (form?.revealed) {
			secret = { ...form.revealed, recopyable: true };
		}
		if (form?.success) {
			editing = null;
			invalidateAll();
		}
	});

	const stats = $derived(tokenStats(data.tokens));

	// Revoked tokens are kept for the audit trail but hidden by default —
	// the row is functionally dead the moment it's revoked.
	let showRevoked = $state(false);
	const revokedCount = $derived(data.tokens.filter((t) => t.revokedAt).length);
	const visibleTokens = $derived(
		showRevoked ? data.tokens : data.tokens.filter((t) => !t.revokedAt)
	);

	function startEdit(t: Token) {
		editing = {
			id: t.id,
			name: t.name,
			serviceId: t.serviceId,
			scopes: [...t.scopes],
			policyId: t.policyId ?? '',
			...inlineLimitsFromRow(t)
		};
	}
</script>

<PageShell width="default">
	<PageHeader
		title="Machine Tokens"
		description="Opaque, hashed-at-rest tokens your services use to authenticate to the gateway."
	>
		{#snippet action()}
			{#if canManage}
				<CreateTokenDialog
					bind:open={createOpen}
					services={data.services}
					policies={data.policies}
					providers={data.providers}
					recopyDefault={data.recopyDefault}
					message={form?.message}
				/>
			{/if}
		{/snippet}
	</PageHeader>

	{#if data.tokens.length === 0}
		<EmptyState
			icon={KeyRound}
			title="No tokens yet"
			description="Issue a token to start calling the gateway. New tokens land in the Default service — organise them into services later."
		/>
	{:else}
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
			<StatCard label="Total" value={stats.total} />
			<StatCard label="Active">
				<p class="mt-1 flex items-center gap-2 text-2xl font-semibold tabular-nums">
					<span class="dot-pulse size-2 rounded-full bg-emerald-500"></span>
					{stats.active}
				</p>
			</StatCard>
			<StatCard
				label="Inactive"
				value={stats.inactive}
				valueClass="text-2xl text-muted-foreground"
			/>
			<StatCard
				label="Last used"
				value={relativeTime(stats.lastUsed ? new Date(stats.lastUsed) : null)}
				valueClass="text-lg"
			/>
		</div>

		{#if revokedCount > 0}
			<div class="flex items-center justify-end gap-2">
				<Switch id="showRevoked" bind:checked={showRevoked} />
				<Label for="showRevoked" class="text-sm text-muted-foreground">
					Show revoked ({revokedCount})
				</Label>
			</div>
		{/if}

		<div class="rounded-xl border">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Name</Table.Head>
						<Table.Head>Token</Table.Head>
						<Table.Head>Service</Table.Head>
						<Table.Head>Scopes</Table.Head>
						<Table.Head>Policy / Models</Table.Head>
						<Table.Head>Last used</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head class="w-10"></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#if visibleTokens.length === 0}
						<Table.Row class="hover:bg-transparent">
							<Table.Cell colspan={8} class="py-8 text-center text-sm text-muted-foreground">
								All tokens are revoked. Toggle “Show revoked” to view them.
							</Table.Cell>
						</Table.Row>
					{/if}
					{#each visibleTokens as t (t.id)}
						<TokenRow token={t} {canManage} onEdit={startEdit} />
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	{/if}
</PageShell>

<!-- one-time secret reveal -->
<SecretDialog
	{secret}
	onClose={() => {
		secret = null;
		invalidateAll();
	}}
/>

<EditTokenDialog
	{editing}
	onClose={() => (editing = null)}
	policies={data.policies}
	providers={data.providers}
	services={data.services}
	message={form?.message}
/>
