<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import PageHeader from '$lib/components/page-header.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import ConfirmAction from '$lib/components/confirm-action.svelte';
	import PolicyForm, { type PolicyFormValues } from '$lib/components/policy-form.svelte';
	import { can } from '$lib/permissions';
	import ShieldHalf from '@lucide/svelte/icons/shield-half';
	import Plus from '@lucide/svelte/icons/plus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Gauge from '@lucide/svelte/icons/gauge';
	import Wallet from '@lucide/svelte/icons/wallet';
	import DatabaseZap from '@lucide/svelte/icons/database-zap';
	import Waypoints from '@lucide/svelte/icons/waypoints';

	const fmtBudget = (daily: string | number, monthly: string | number) => {
		const d = Number(daily);
		const m = Number(monthly);
		const parts: string[] = [];
		if (d > 0) parts.push(`$${d}/day`);
		if (m > 0) parts.push(`$${m}/mo`);
		return parts.length ? parts.join(' · ') : 'No budget';
	};

	let { data, form } = $props();
	let open = $state(false);
	let editing = $state<PolicyFormValues | null>(null);

	const createValues: PolicyFormValues = {
		name: '',
		allowedProviders: [],
		allowedModels: '',
		preferredProvider: '',
		rateLimitPerMinute: 0,
		dailyBudgetUsd: 0,
		monthlyBudgetUsd: 0,
		cacheTtlSeconds: '',
		tracingEnabled: ''
	};

	const canManage = $derived(can(data.role, 'policies:manage', data.memberPermissions));

	$effect(() => {
		if (form?.success) {
			open = false;
			editing = null;
			invalidateAll();
		}
	});
</script>

<div class="mx-auto max-w-4xl space-y-6">
	<PageHeader title="Presets">
		{#snippet description()}
			Reusable limit & access baselines. Attach one to a service or token, then override individual
			fields inline. Empty lists mean "allow all".
		{/snippet}
		{#snippet action()}
			{#if canManage}
				<Dialog.Root bind:open>
					<Dialog.Trigger>
						{#snippet child({ props })}
							<Button {...props}><Plus class="size-4" /> New preset</Button>
						{/snippet}
					</Dialog.Trigger>
					<Dialog.Content>
						<Dialog.Header>
							<Dialog.Title>Create preset</Dialog.Title>
							<Dialog.Description>
								A reusable baseline. Services and tokens that attach it inherit its values, then
								override any field inline.
							</Dialog.Description>
						</Dialog.Header>
						<PolicyForm
							providers={data.providers}
							action="?/create"
							submitLabel="Create preset"
							idPrefix="create"
							values={createValues}
							resetOnSuccess
						/>
					</Dialog.Content>
				</Dialog.Root>
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
				<Card.Root>
					<Card.Header class="flex flex-row items-start justify-between space-y-0">
						<div class="flex items-center gap-3">
							<div class="flex size-9 items-center justify-center rounded-lg border bg-muted">
								<ShieldHalf class="size-4" />
							</div>
							<Card.Title class="text-base">{p.name}</Card.Title>
						</div>
						{#if canManage}
							<div class="flex items-center gap-1">
								<Button
									variant="ghost"
									size="icon"
									class="size-8 text-muted-foreground"
									title="Edit policy"
									onclick={() =>
										(editing = {
											id: p.id,
											name: p.name,
											allowedProviders: [...p.allowedProviders],
											allowedModels: p.allowedModels.join(', '),
											preferredProvider: p.preferredProvider ?? '',
											rateLimitPerMinute: p.rateLimitPerMinute,
											dailyBudgetUsd: String(Number(p.dailyBudgetUsd)),
											monthlyBudgetUsd: String(Number(p.monthlyBudgetUsd)),
											cacheTtlSeconds: p.cacheTtlSeconds == null ? '' : String(p.cacheTtlSeconds),
											tracingEnabled: p.tracingEnabled == null ? '' : String(p.tracingEnabled)
										})}
								>
									<Pencil class="size-4" />
								</Button>
								<ConfirmAction
									action="?/delete"
									title={`Delete “${p.name}”?`}
									description="Services assigned to this policy will no longer be governed by it. This can't be undone."
									actionLabel="Delete policy"
								>
									{#snippet trigger({ props })}
										<Button
											{...props}
											variant="ghost"
											size="icon"
											class="size-8 text-muted-foreground hover:text-destructive"
											title="Delete policy"
										>
											<Trash2 class="size-4" />
										</Button>
									{/snippet}
									{#snippet fields()}
										<input type="hidden" name="id" value={p.id} />
									{/snippet}
								</ConfirmAction>
							</div>
						{/if}
					</Card.Header>
					<Card.Content class="space-y-3 text-sm">
						<div>
							<div class="mb-1 text-xs font-medium text-muted-foreground">Providers</div>
							{#if p.allowedProviders.length === 0}
								<Badge variant="outline">all</Badge>
							{:else}
								<div class="flex flex-wrap gap-1">
									{#each p.allowedProviders as pr (pr)}<Badge variant="secondary">{pr}</Badge
										>{/each}
								</div>
							{/if}
						</div>
						<div>
							<div class="mb-1 text-xs font-medium text-muted-foreground">Models</div>
							{#if p.allowedModels.length === 0}
								<Badge variant="outline">all</Badge>
							{:else}
								<div class="flex flex-wrap gap-1">
									{#each p.allowedModels as m (m)}<Badge variant="secondary">{m}</Badge>{/each}
								</div>
							{/if}
						</div>
						<div
							class="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground"
						>
							<span class="flex items-center gap-1.5">
								<Gauge class="size-3.5" />
								{p.rateLimitPerMinute === 0 ? 'Unlimited' : `${p.rateLimitPerMinute} req/min`}
							</span>
							<span class="flex items-center gap-1.5">
								<Wallet class="size-3.5" />
								{fmtBudget(p.dailyBudgetUsd, p.monthlyBudgetUsd)}
							</span>
							<span class="flex items-center gap-1.5">
								<DatabaseZap class="size-3.5" />
								{p.cacheTtlSeconds == null
									? 'Cache: inherit'
									: p.cacheTtlSeconds === 0
										? 'Cache: off'
										: `Cache ${p.cacheTtlSeconds}s`}
							</span>
							<span class="flex items-center gap-1.5">
								<Waypoints class="size-3.5" />
								{p.tracingEnabled == null
									? 'Trace: inherit'
									: p.tracingEnabled
										? 'Trace: on'
										: 'Trace: off'}
							</span>
						</div>
					</Card.Content>
				</Card.Root>
			{/each}
		</div>
	{/if}
</div>

<Dialog.Root
	open={editing !== null}
	onOpenChange={(v) => {
		if (!v) editing = null;
	}}
>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Edit preset</Dialog.Title>
			<Dialog.Description>
				Changes apply to every service and token that inherits this preset.
			</Dialog.Description>
		</Dialog.Header>
		{#if editing}
			{#key editing.id}
				<PolicyForm
					providers={data.providers}
					action="?/update"
					submitLabel="Save preset"
					idPrefix="edit"
					values={editing}
				/>
			{/key}
		{/if}
	</Dialog.Content>
</Dialog.Root>
