<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { resolve } from '$app/paths';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import PageHeader from '$lib/components/layout/page-header.svelte';
	import EmptyState from '$lib/components/layout/empty-state.svelte';
	import ConfirmAction from '$lib/components/form/confirm-action.svelte';
	import ServiceForm, { type ServiceFormValues } from './service-form.svelte';
	import { emptyInlineLimits, inlineLimitsFromRow } from '$lib/features/policies/inline-limits';
	import { relativeTime } from '$lib/format';
	import {
		actionError,
		deleteServiceDescription,
		serviceTypeLabel,
		SUCCESS_MESSAGES,
		type ActionResult
	} from './service-display';
	import { can } from '$lib/permissions';
	import Plus from '@lucide/svelte/icons/plus';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Pencil from '@lucide/svelte/icons/pencil';
	import PageShell from '$lib/components/layout/page-shell.svelte';

	let { data, form } = $props();
	let open = $state(false);
	let editing = $state<ServiceFormValues | null>(null);

	const policyName = $derived(new Map(data.policies.map((p) => [p.id, p.name] as const)));
	const canManage = $derived(can(data.role, 'services:manage', data.memberPermissions));
	const secretOptions = $derived(data.providerSecrets ?? []);

	// The result whose dialog the user closed; keeps its error from reappearing on reopen.
	let dismissed = $state<ActionResult | null>(null);
	const createError = $derived(actionError(form, 'create', dismissed));
	const updateError = $derived(actionError(form, 'update', dismissed));

	const createValues: ServiceFormValues = {
		...emptyInlineLimits(),
		name: '',
		type: 'app',
		description: '',
		policyId: '',
		providerSecretId: ''
	};

	// Close the active dialog and refresh once an action succeeds. Errors of
	// create/update render inside their dialog; delete has none left open.
	$effect(() => {
		if (!form) return;
		if (form.success) {
			open = false;
			editing = null;
			toast.success(SUCCESS_MESSAGES[form.action] ?? 'Done');
			invalidateAll();
		} else if (form.message && form.action === 'delete') {
			toast.error(form.message);
		}
	});

	function closeDialogs() {
		dismissed = form ?? null;
	}

	// The detail page redirects here after deleting, naming the service once in the URL.
	onMount(() => {
		const deleted = page.url.searchParams.get('deleted');
		if (deleted === null) return;
		toast.success(`Service “${deleted}” deleted`);
		// the list reads no other query params, so the bare path is the clean URL
		replaceState(resolve('/app/services'), page.state);
	});

	type ServiceRow = (typeof data.services)[number];
	function startEdit(s: ServiceRow) {
		editing = {
			id: s.id,
			name: s.name,
			type: s.type,
			description: s.description ?? '',
			policyId: s.policyId ?? '',
			providerSecretId: s.providerSecretId ?? '',
			...inlineLimitsFromRow(s)
		};
	}
</script>

<PageShell width="default">
	<PageHeader
		title="Services"
		description="The apps, agents and workloads that call the gateway, each with its own tokens and shared limits."
	>
		{#snippet action()}
			{#if canManage}
				<Dialog.Root
					bind:open
					onOpenChange={(v) => {
						if (!v) closeDialogs();
					}}
				>
					<Dialog.Trigger>
						{#snippet child({ props })}
							<Button {...props}><Plus class="size-4" /> New service</Button>
						{/snippet}
					</Dialog.Trigger>
					<Dialog.Content class="max-h-[88vh] overflow-y-auto sm:max-w-lg">
						<Dialog.Header>
							<Dialog.Title>Create service</Dialog.Title>
							<Dialog.Description>
								Group tokens for one app or agent and give them shared limits, budget and a preset.
							</Dialog.Description>
						</Dialog.Header>
						<ServiceForm
							defaults={data.defaults}
							action="?/create"
							submitLabel="Create service"
							idPrefix="svc-create"
							values={createValues}
							policies={data.policies}
							providers={data.providers}
							{secretOptions}
							message={createError}
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
			description="Tokens you issue land in the Default service automatically. Create a service to group tokens by app or workload and give them shared limits."
		>
			<div class="flex flex-wrap items-center justify-center gap-2">
				{#if canManage}
					<Button onclick={() => (open = true)}><Plus class="size-4" /> New service</Button>
				{:else}
					<p class="text-sm text-muted-foreground">Ask an admin to create a service.</p>
				{/if}
				<Button variant="outline" href={resolve('/app/tokens')}>Go to tokens</Button>
			</div>
		</EmptyState>
	{:else}
		<div class="rounded-xl border">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Name</Table.Head>
						<Table.Head>Type</Table.Head>
						<Table.Head>Preset</Table.Head>
						<Table.Head class="text-right">Active tokens</Table.Head>
						<Table.Head>Created</Table.Head>
						<Table.Head class="w-24"><span class="sr-only">Actions</span></Table.Head>
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
							<Table.Cell><Badge variant="outline">{serviceTypeLabel(s.type)}</Badge></Table.Cell>
							<Table.Cell class="text-muted-foreground">
								{#if s.policyId && policyName.get(s.policyId)}
									<a href={resolve('/app/policies')} class="hover:text-foreground hover:underline">
										{policyName.get(s.policyId)}
									</a>
								{:else}
									—
								{/if}
							</Table.Cell>
							<Table.Cell
								class="text-right tabular-nums {s.activeTokenCount === 0
									? 'text-muted-foreground'
									: ''}"
							>
								{s.activeTokenCount}
							</Table.Cell>
							<Table.Cell class="text-muted-foreground">{relativeTime(s.createdAt)}</Table.Cell>
							<Table.Cell>
								{#if canManage}
									<div class="flex items-center gap-1">
										<Button
											variant="ghost"
											size="icon"
											class="size-10 text-muted-foreground hover:text-foreground"
											aria-label={`Edit ${s.name}`}
											title="Edit service"
											onclick={() => startEdit(s)}
										>
											<Pencil class="size-4" />
										</Button>
										<ConfirmAction
											action="?/delete"
											title={`Delete “${s.name}”?`}
											description={deleteServiceDescription(s.activeTokenCount, s.name)}
											actionLabel="Delete service"
										>
											{#snippet trigger({ props })}
												<Button
													{...props}
													variant="ghost"
													size="icon"
													class="size-10 text-muted-foreground hover:text-destructive"
													aria-label={`Delete ${s.name}`}
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
</PageShell>

<Dialog.Root
	open={editing !== null}
	onOpenChange={(v) => {
		if (!v) {
			editing = null;
			closeDialogs();
		}
	}}
>
	<Dialog.Content class="max-h-[88vh] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Edit service</Dialog.Title>
			<Dialog.Description
				>Changes apply immediately to all tokens in this service.</Dialog.Description
			>
		</Dialog.Header>
		{#if editing}
			{#key editing.id}
				<ServiceForm
					defaults={data.defaults}
					action="?/update"
					submitLabel="Save changes"
					idPrefix="svc-edit"
					values={editing}
					policies={data.policies}
					providers={data.providers}
					{secretOptions}
					message={updateError}
				/>
			{/key}
		{/if}
	</Dialog.Content>
</Dialog.Root>
