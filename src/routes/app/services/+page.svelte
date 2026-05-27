<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { relativeTime } from '$lib/format';
	import { can } from '$lib/permissions';
	import Plus from '@lucide/svelte/icons/plus';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Pencil from '@lucide/svelte/icons/pencil';

	let { data } = $props();
	let open = $state(false);
	let createType = $state('app');
	let createPolicyId = $state('');
	let editing = $state<{
		id: string;
		name: string;
		type: string;
		description: string;
		policyId: string;
	} | null>(null);

	const policyName = $derived(new Map(data.policies.map((p) => [p.id, p.name] as const)));
	const typeOptions = [
		{ value: 'app', label: 'App' },
		{ value: 'agent', label: 'Agent' },
		{ value: 'workload', label: 'Workload' }
	];
	const policyLabel = (id: string) => (id ? (policyName.get(id) ?? id) : 'No policy (allow all)');
	const canManage = $derived(can(data.role, 'services:manage', data.memberPermissions));
</script>

<div class="mx-auto max-w-5xl space-y-6">
	<div class="flex items-start justify-between gap-4">
		<div>
			<h2 class="text-xl font-semibold tracking-tight">Services</h2>
			<p class="text-sm text-muted-foreground">
				Machine identities — apps, workloads and agents that call the gateway.
			</p>
		</div>
		{#if canManage}
			<Dialog.Root bind:open>
			<Dialog.Trigger>
				{#snippet child({ props })}
					<Button {...props}><Plus class="size-4" /> New service</Button>
				{/snippet}
			</Dialog.Trigger>
			<Dialog.Content>
				<Dialog.Header>
					<Dialog.Title>Create service</Dialog.Title>
					<Dialog.Description>A service represents one machine identity.</Dialog.Description>
				</Dialog.Header>
				<form
					method="post"
					action="?/create"
					class="space-y-4"
					use:enhance={() => {
						return async ({ result, update }) => {
							await update({ reset: true });
							if (result.type === 'success') {
								open = false;
								await invalidateAll();
							}
						};
					}}
				>
					<div class="space-y-2">
						<Label for="name">Name</Label>
						<Input id="name" name="name" placeholder="support-agent" required />
					</div>
					<div class="space-y-2">
						<Label for="type">Type</Label>
						<Select.Root type="single" name="type" bind:value={createType}>
							<Select.Trigger id="type" class="w-full">
								{typeOptions.find((o) => o.value === createType)?.label}
							</Select.Trigger>
							<Select.Content>
								{#each typeOptions as o (o.value)}
									<Select.Item value={o.value} label={o.label}>{o.label}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					<div class="space-y-2">
						<Label for="policyId">Policy</Label>
						<Select.Root type="single" name="policyId" bind:value={createPolicyId}>
							<Select.Trigger id="policyId" class="w-full">{policyLabel(createPolicyId)}</Select.Trigger>
							<Select.Content>
								<Select.Item value="" label="No policy (allow all)">No policy (allow all)</Select.Item>
								{#each data.policies as p (p.id)}
									<Select.Item value={p.id} label={p.name}>{p.name}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					<div class="space-y-2">
						<Label for="description">Description</Label>
						<Input id="description" name="description" placeholder="Optional" />
					</div>
					<Dialog.Footer>
						<Button type="submit">Create service</Button>
					</Dialog.Footer>
				</form>
			</Dialog.Content>
			</Dialog.Root>
		{/if}
	</div>

	{#if data.services.length === 0}
		<div class="flex flex-col items-center justify-center rounded-xl border border-dashed py-16">
			<Boxes class="size-8 text-muted-foreground" />
			<p class="mt-3 text-sm font-medium">No services yet</p>
			<p class="text-sm text-muted-foreground">
				Create your first service to start issuing tokens.
			</p>
		</div>
	{:else}
		<div class="rounded-xl border">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Name</Table.Head>
						<Table.Head>Type</Table.Head>
						<Table.Head>Policy</Table.Head>
						<Table.Head>Created</Table.Head>
						<Table.Head class="w-10"></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.services as s (s.id)}
						<Table.Row>
							<Table.Cell>
								<div class="font-medium">{s.name}</div>
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
										onclick={() =>
											(editing = {
												id: s.id,
												name: s.name,
												type: s.type,
												description: s.description ?? '',
												policyId: s.policyId ?? ''
											})}
									>
										<Pencil class="size-4" />
									</Button>
									<AlertDialog.Root>
										<AlertDialog.Trigger>
											{#snippet child({ props })}
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
										</AlertDialog.Trigger>
										<AlertDialog.Content>
											<AlertDialog.Header>
												<AlertDialog.Title>Delete “{s.name}”?</AlertDialog.Title>
												<AlertDialog.Description>
													Any tokens issued to this service stop working immediately. This can't be
													undone.
												</AlertDialog.Description>
											</AlertDialog.Header>
											<AlertDialog.Footer>
												<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
												<form
													method="post"
													action="?/delete"
													use:enhance={() =>
														async ({ update }) =>
															update()}
												>
													<input type="hidden" name="id" value={s.id} />
													<AlertDialog.Action type="submit" variant="destructive">
														Delete service
													</AlertDialog.Action>
												</form>
											</AlertDialog.Footer>
										</AlertDialog.Content>
									</AlertDialog.Root>
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
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Edit service</Dialog.Title>
			<Dialog.Description>Update this machine identity.</Dialog.Description>
		</Dialog.Header>
		{#if editing}
			<form
				method="post"
				action="?/update"
				class="space-y-4"
				use:enhance={() => {
					return async ({ result, update }) => {
						await update({ reset: true });
						if (result.type === 'success') {
							editing = null;
							await invalidateAll();
						}
					};
				}}
			>
				<input type="hidden" name="id" value={editing?.id} />
				<div class="space-y-2">
					<Label for="edit-name">Name</Label>
					<Input
						id="edit-name"
						name="name"
						placeholder="support-agent"
						bind:value={editing.name}
						required
					/>
				</div>
				<div class="space-y-2">
					<Label for="edit-type">Type</Label>
					<Select.Root type="single" name="type" bind:value={editing.type}>
						<Select.Trigger id="edit-type" class="w-full">
							{typeOptions.find((o) => o.value === editing?.type)?.label}
						</Select.Trigger>
						<Select.Content>
							{#each typeOptions as o (o.value)}
								<Select.Item value={o.value} label={o.label}>{o.label}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="space-y-2">
					<Label for="edit-policyId">Policy</Label>
					<Select.Root type="single" name="policyId" bind:value={editing.policyId}>
						<Select.Trigger id="edit-policyId" class="w-full"
							>{policyLabel(editing?.policyId ?? '')}</Select.Trigger
						>
						<Select.Content>
							<Select.Item value="" label="No policy (allow all)">No policy (allow all)</Select.Item>
							{#each data.policies as p (p.id)}
								<Select.Item value={p.id} label={p.name}>{p.name}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="space-y-2">
					<Label for="edit-description">Description</Label>
					<Input
						id="edit-description"
						name="description"
						placeholder="Optional"
						bind:value={editing.description}
					/>
				</div>
				<Dialog.Footer>
					<Button type="submit">Save changes</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
