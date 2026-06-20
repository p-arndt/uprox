<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import PageHeader from '$lib/components/page-header.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import StatCard from '$lib/components/stat-card.svelte';
	import TokenRow from '$lib/components/token-row.svelte';
	import CreateTokenDialog from '$lib/components/create-token-dialog.svelte';
	import EditTokenDialog from '$lib/components/edit-token-dialog.svelte';
	import SecretDialog from '$lib/components/secret-dialog.svelte';
	import { type TokenFormValues } from '$lib/components/token-form.svelte';
	import { tokenStats, type RevealedSecret, type Token } from '$lib/tokens';
	import { relativeTime } from '$lib/format';
	import { can } from '$lib/permissions';
	import KeyRound from '@lucide/svelte/icons/key-round';

	let { data, form } = $props();
	let createOpen = $state(false);
	// `recopyable` switches the dialog copy between "stored only as a hash, gone
	// forever" and "you can reveal this again later".
	let secret = $state<RevealedSecret | null>(null);
	let editing = $state<TokenFormValues | null>(null);

	const canManage = $derived(can(data.role, 'tokens:manage', data.memberPermissions));

	// When the create action returns a fresh secret, reveal it once.
	$effect(() => {
		if (form?.created) {
			secret = form.created;
			createOpen = false;
		}
	});

	// A re-copy reveal returns the stored secret again.
	$effect(() => {
		if (form?.revealed) {
			secret = { ...form.revealed, recopyable: true };
		}
	});

	// Close the edit dialog once an update succeeds.
	$effect(() => {
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

	// null inline column → '' (inherit) in the form; budgets are stored as numeric
	// strings, normalized to a plain number for display.
	const numStr = (v: number | string | null) => (v == null ? '' : String(Number(v)));

	function startEdit(t: Token) {
		editing = {
			id: t.id,
			name: t.name,
			scopes: [...t.scopes],
			policyId: t.policyId ?? '',
			allowedProviders: t.allowedProviders ?? [],
			allowedModels: t.allowedModels.join(', '),
			preferredProvider: t.preferredProvider ?? '',
			rateLimitPerMinute: t.rateLimitPerMinute == null ? '' : String(t.rateLimitPerMinute),
			dailyBudgetUsd: numStr(t.dailyBudgetUsd),
			monthlyBudgetUsd: numStr(t.monthlyBudgetUsd),
			cacheTtlSeconds: t.cacheTtlSeconds == null ? '' : String(t.cacheTtlSeconds),
			tracingEnabled: t.tracingEnabled == null ? '' : String(t.tracingEnabled)
		};
	}
</script>

<div class="mx-auto max-w-5xl space-y-6">
	<PageHeader
		title="Machine Tokens"
		description="Opaque, hashed-at-rest tokens your services use to authenticate to the gateway."
	>
		{#snippet action()}
			{#if canManage}
				<CreateTokenDialog
					bind:open={createOpen}
					disabled={data.services.length === 0}
					services={data.services}
					policies={data.policies}
					providers={data.providers}
					recopyDefault={data.recopyDefault}
					message={form?.message}
				/>
			{/if}
		{/snippet}
	</PageHeader>

	{#if data.services.length === 0}
		<EmptyState
			icon={KeyRound}
			title="Create a service first"
			description="Tokens are issued against a service."
		>
			<Button href={resolve('/app/services')} variant="outline" size="sm">Go to services</Button>
		</EmptyState>
	{:else if data.tokens.length === 0}
		<EmptyState
			icon={KeyRound}
			title="No tokens yet"
			description="Issue a token to authenticate a service."
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
</div>

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
	message={form?.message}
/>
