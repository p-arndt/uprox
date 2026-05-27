<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { NativeSelect } from '$lib/components/ui/native-select/index.js';
	import { relativeTime } from '$lib/format';
	import { can } from '$lib/permissions';
	import Plus from '@lucide/svelte/icons/plus';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Pencil from '@lucide/svelte/icons/pencil';

	let { data } = $props();
	let open = $state(false);
	let editing = $state<{
		id: string;
		name: string;
		type: string;
		description: string;
		policyId: string;
	} | null>(null);

	const policyName = $derived(new Map(data.policies.map((p) => [p.id, p.name] as const)));
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
						<NativeSelect id="type" name="type" class="w-full">
							<option value="app">App</option>
							<option value="agent">Agent</option>
							<option value="workload">Workload</option>
						</NativeSelect>
					</div>
					<div class="space-y-2">
						<Label for="policyId">Policy</Label>
						<NativeSelect id="policyId" name="policyId" class="w-full">
							<option value="">No policy (allow all)</option>
							{#each data.policies as p (p.id)}
								<option value={p.id}>{p.name}</option>
							{/each}
						</NativeSelect>
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
									<form
										method="post"
										action="?/delete"
										use:enhance={() =>
											async ({ update }) =>
												update()}
									>
										<input type="hidden" name="id" value={s.id} />
										<Button
											type="submit"
											variant="ghost"
											size="icon"
											class="size-8 text-muted-foreground hover:text-destructive"
											title="Delete service"
										>
											<Trash2 class="size-4" />
										</Button>
									</form>
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
					<NativeSelect id="edit-type" name="type" class="w-full" bind:value={editing.type}>
						<option value="app">App</option>
						<option value="agent">Agent</option>
						<option value="workload">Workload</option>
					</NativeSelect>
				</div>
				<div class="space-y-2">
					<Label for="edit-policyId">Policy</Label>
					<NativeSelect
						id="edit-policyId"
						name="policyId"
						class="w-full"
						bind:value={editing.policyId}
					>
						<option value="">No policy (allow all)</option>
						{#each data.policies as p (p.id)}
							<option value={p.id}>{p.name}</option>
						{/each}
					</NativeSelect>
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
