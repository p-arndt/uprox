<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import PageHeader from '$lib/components/page-header.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import ConfirmAction from '$lib/components/confirm-action.svelte';
	import ServiceForm, { type ServiceFormValues } from '$lib/components/service-form.svelte';
	import { emptyInlineLimits } from '$lib/components/inline-limits';
	import { relativeTime } from '$lib/format';
	import { can } from '$lib/permissions';
	import Plus from '@lucide/svelte/icons/plus';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Pencil from '@lucide/svelte/icons/pencil';

	let { data, form } = $props();
	let open = $state(false);
	let editing = $state<ServiceFormValues | null>(null);

	const policyName = $derived(new Map(data.policies.map((p) => [p.id, p.name] as const)));
	const canManage = $derived(can(data.role, 'services:manage', data.memberPermissions));
	const secretOptions = $derived(data.providerSecrets ?? []);

	const createValues: ServiceFormValues = {
		...emptyInlineLimits(),
		name: '',
		type: 'app',
		description: '',
		policyId: '',
		providerSecretId: ''
	};

	// Close the active dialog and refresh once a create/update succeeds.
	$effect(() => {
		if (form?.success) {
			open = false;
			editing = null;
			invalidateAll();
		}
	});

	// null inline column → '' (inherit) in the form; budgets are numeric strings,
	// normalized to a plain number for display.
	const numStr = (v: number | string | null) => (v == null ? '' : String(Number(v)));
	type ServiceRow = (typeof data.services)[number];
	function startEdit(s: ServiceRow) {
		editing = {
			id: s.id,
			name: s.name,
			type: s.type,
			description: s.description ?? '',
			policyId: s.policyId ?? '',
			providerSecretId: s.providerSecretId ?? '',
			allowedProviders: s.allowedProviders ?? [],
			allowedModels: (s.allowedModels ?? []).join(', '),
			preferredProvider: s.preferredProvider ?? '',
			rateLimitPerMinute: s.rateLimitPerMinute == null ? '' : String(s.rateLimitPerMinute),
			dailyBudgetUsd: numStr(s.dailyBudgetUsd),
			monthlyBudgetUsd: numStr(s.monthlyBudgetUsd),
			cacheTtlSeconds: s.cacheTtlSeconds == null ? '' : String(s.cacheTtlSeconds),
			tracingEnabled: s.tracingEnabled == null ? '' : String(s.tracingEnabled)
		};
	}
</script>

<div class="mx-auto max-w-5xl space-y-6">
	<PageHeader
		title="Services"
		description="Machine identities — apps, workloads and agents that call the gateway."
	>
		{#snippet action()}
			{#if canManage}
				<Dialog.Root bind:open>
					<Dialog.Trigger>
						{#snippet child({ props })}
							<Button {...props}><Plus class="size-4" /> New service</Button>
						{/snippet}
					</Dialog.Trigger>
					<Dialog.Content class="max-h-[88vh] overflow-y-auto sm:max-w-lg">
						<Dialog.Header>
							<Dialog.Title>Create service</Dialog.Title>
							<Dialog.Description>A service represents one machine identity.</Dialog.Description>
						</Dialog.Header>
						<ServiceForm
							action="?/create"
							submitLabel="Create service"
							idPrefix="svc-create"
							values={createValues}
							policies={data.policies}
							providers={data.providers}
							{secretOptions}
							resetOnSuccess
						/>
					</Dialog.Content>
				</Dialog.Root>
			{/if}
		{/snippet}
	</PageHeader>

	{#if data.services.length === 0}
		<EmptyState
			icon={Boxes}
			title="No services yet"
			description="Create your first service to start issuing tokens."
		/>
	{:else}
		<div class="rounded-xl border">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Name</Table.Head>
						<Table.Head>Type</Table.Head>
						<Table.Head>Preset</Table.Head>
						<Table.Head>Created</Table.Head>
						<Table.Head class="w-10"></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.services as s (s.id)}
						<Table.Row>
							<Table.Cell>
								<a
									href={resolve('/app/services/[id]', { id: s.id })}
									class="font-medium hover:underline"
								>
									{s.name}
								</a>
								{#if s.description}
									<div class="text-xs text-muted-foreground">{s.description}</div>
								{/if}
							</Table.Cell>
							<Table.Cell><Badge variant="outline">{s.type}</Badge></Table.Cell>
							<Table.Cell class="text-muted-foreground">
								{s.policyId ? policyName.get(s.policyId) : '—'}
							</Table.Cell>
							<Table.Cell class="text-muted-foreground">{relativeTime(s.createdAt)}</Table.Cell>
							<Table.Cell>
								{#if canManage}
									<div class="flex items-center gap-1">
										<Button
											variant="ghost"
											size="icon"
											class="size-8 text-muted-foreground hover:text-foreground"
											title="Edit service"
											onclick={() => startEdit(s)}
										>
											<Pencil class="size-4" />
										</Button>
										<ConfirmAction
											action="?/delete"
											title={`Delete “${s.name}”?`}
											description="Any tokens issued to this service stop working immediately. This can't be undone."
											actionLabel="Delete service"
										>
											{#snippet trigger({ props })}
												<Button
													{...props}
													variant="ghost"
													size="icon"
													class="size-8 text-muted-foreground hover:text-destructive"
													title="Delete service"
												>
													<Trash2 class="size-4" />
												</Button>
											{/snippet}
											{#snippet fields()}
												<input type="hidden" name="id" value={s.id} />
											{/snippet}
										</ConfirmAction>
									</div>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	{/if}
</div>

<Dialog.Root
	open={editing !== null}
	onOpenChange={(v) => {
		if (!v) editing = null;
	}}
>
	<Dialog.Content class="max-h-[88vh] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Edit service</Dialog.Title>
			<Dialog.Description>Update this machine identity.</Dialog.Description>
		</Dialog.Header>
		{#if editing}
			{#key editing.id}
				<ServiceForm
					action="?/update"
					submitLabel="Save changes"
					idPrefix="svc-edit"
					values={editing}
					policies={data.policies}
					providers={data.providers}
					{secretOptions}
				/>
			{/key}
		{/if}
	</Dialog.Content>
</Dialog.Root>
