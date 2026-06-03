<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { relativeTime } from '$lib/format';
	import { can } from '$lib/permissions';
	import Plug from '@lucide/svelte/icons/plug';
	import Lock from '@lucide/svelte/icons/lock';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	let { data, form } = $props();

	type Secret = (typeof data.secrets)[number];

	// add a new key (per provider)
	let adding = $state<{
		provider: string;
		label: string;
		requiresEndpoint: boolean;
	} | null>(null);
	// rotate an existing key
	let rotating = $state<{ id: string; label: string } | null>(null);
	// edit label / endpoint / priority of an existing secret
	let editingMeta = $state<{
		id: string;
		provider: string;
		label: string;
		requiresEndpoint: boolean;
		baseUrl: string;
		priority: number;
	} | null>(null);

	// secrets grouped by provider, preserving the load order (priority desc)
	const byProvider = $derived(
		data.secrets.reduce((m, s) => {
			(m.get(s.provider) ?? m.set(s.provider, []).get(s.provider)!).push(s);
			return m;
		}, new Map<string, Secret[]>())
	);
	const canManage = $derived(can(data.role, 'providers:manage', data.memberPermissions));

	// the host of an endpoint URL, for a compact secondary label
	const endpointHost = (url: string | null) => {
		if (!url) return null;
		try {
			return new URL(url).host;
		} catch {
			return url;
		}
	};

	$effect(() => {
		if (form?.success) {
			adding = null;
			rotating = null;
			editingMeta = null;
			invalidateAll();
		}
	});
</script>

<div class="mx-auto max-w-4xl space-y-6">
	<div>
		<h2 class="text-xl font-semibold tracking-tight">Providers</h2>
		<p class="text-sm text-muted-foreground">
			Upstream API keys, encrypted at rest with AES-256-GCM. The gateway decrypts them only to proxy
			a request. A provider can hold several keys — e.g. one per Azure OpenAI resource — and a
			service picks which one it uses.
		</p>
	</div>

	<div class="space-y-4">
		{#each data.providers as p (p.id)}
			{@const secrets = byProvider.get(p.id) ?? []}
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0">
					<div class="flex items-center gap-3">
						<div class="flex size-9 items-center justify-center rounded-lg border bg-muted">
							<Plug class="size-4" />
						</div>
						<div>
							<Card.Title class="text-base">{p.label}</Card.Title>
							<Card.Description class="text-xs">
								{secrets.length}
								{secrets.length === 1 ? 'key' : 'keys'} configured
							</Card.Description>
						</div>
					</div>
					{#if canManage}
						<Button
							variant="outline"
							size="sm"
							onclick={() =>
								(adding = {
									provider: p.id,
									label: p.label,
									requiresEndpoint: p.requiresEndpoint
								})}
						>
							<Plus class="size-4" />
							{p.requiresEndpoint ? 'Add endpoint' : 'Add key'}
						</Button>
					{/if}
				</Card.Header>
				<Card.Content class="space-y-2">
					{#if secrets.length === 0}
						<p class="text-sm text-muted-foreground">No key configured.</p>
					{:else}
						{#each secrets as s (s.id)}
							<div class="flex items-center justify-between rounded-lg border px-3 py-2">
								<div class="min-w-0 space-y-1">
									<div class="flex items-center gap-2">
										<span class="truncate text-sm font-medium">{s.label || 'Untitled key'}</span>
										{#if p.requiresEndpoint && endpointHost(s.baseUrl)}
											<Badge variant="outline" class="font-mono text-xs"
												>{endpointHost(s.baseUrl)}</Badge
											>
										{/if}
										{#if secrets.length > 1}
											<Badge variant="secondary" class="text-xs">priority {s.priority}</Badge>
										{/if}
									</div>
									<div class="flex items-center gap-2 text-xs text-muted-foreground">
										<Lock class="size-3" />
										<code>••••{s.hint}</code>
										<span>· updated {relativeTime(s.updatedAt)}</span>
									</div>
								</div>
								{#if canManage}
									<div class="flex shrink-0 items-center gap-1">
										<Button
											variant="outline"
											size="sm"
											onclick={() => (rotating = { id: s.id, label: s.label || p.label })}
										>
											Rotate
										</Button>
										<Button
											variant="outline"
											size="sm"
											onclick={() =>
												(editingMeta = {
													id: s.id,
													provider: p.id,
													label: s.label ?? '',
													requiresEndpoint: p.requiresEndpoint,
													baseUrl: s.baseUrl ?? '',
													priority: s.priority
												})}
										>
											Edit
										</Button>
										<AlertDialog.Root>
											<AlertDialog.Trigger>
												{#snippet child({ props })}
													<Button
														{...props}
														variant="ghost"
														size="icon"
														class="size-8 text-muted-foreground hover:text-destructive"
														title="Remove key"
													>
														<Trash2 class="size-4" />
													</Button>
												{/snippet}
											</AlertDialog.Trigger>
											<AlertDialog.Content>
												<AlertDialog.Header>
													<AlertDialog.Title>Remove this {p.label} key?</AlertDialog.Title>
													<AlertDialog.Description>
														Services pinned to it fall back to the provider's default key. Any
														service left without a usable key stops reaching {p.label}. The
														encrypted key is deleted permanently.
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
															Remove key
														</AlertDialog.Action>
													</form>
												</AlertDialog.Footer>
											</AlertDialog.Content>
										</AlertDialog.Root>
									</div>
								{/if}
							</div>
						{/each}
					{/if}
				</Card.Content>
			</Card.Root>
		{/each}
	</div>
</div>

<!-- Add key -->
<Dialog.Root
	open={adding !== null}
	onOpenChange={(v) => {
		if (!v) adding = null;
	}}
>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Add {adding?.label} key</Dialog.Title>
			<Dialog.Description
				>Stored encrypted. We only ever show the last 4 characters.</Dialog.Description
			>
		</Dialog.Header>
		<form
			method="post"
			action="?/create"
			class="space-y-4"
			use:enhance={() =>
				async ({ update }) =>
					update()}
		>
			<input type="hidden" name="provider" value={adding?.provider} />
			{#if adding?.requiresEndpoint}
				<div class="space-y-2">
					<Label for="baseUrl">Endpoint URL</Label>
					<Input
						id="baseUrl"
						name="baseUrl"
						type="url"
						placeholder="https://my-resource.openai.azure.com"
						autocomplete="off"
						required
					/>
					<p class="text-xs text-muted-foreground">
						Your Azure resource endpoint. Call models by their deployment name (e.g.
						<code>gpt-4o</code>) — no prefix. Add one key per resource and pick it on each service.
					</p>
				</div>
			{/if}
			<div class="space-y-2">
				<Label for="secret">API key</Label>
				<Input
					id="secret"
					name="secret"
					type="password"
					placeholder="sk-…"
					autocomplete="off"
					required
				/>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-2">
					<Label for="label">Label</Label>
					<Input id="label" name="label" placeholder="e.g. Azure East US" />
				</div>
				<div class="space-y-2">
					<Label for="priority">Priority</Label>
					<Input id="priority" name="priority" type="number" value="0" />
				</div>
			</div>
			<p class="text-xs text-muted-foreground">
				When a service hasn't pinned a key, the highest-priority one for the provider is used.
			</p>
			{#if form?.message}
				<p class="text-sm text-destructive">{form.message}</p>
			{/if}
			<Dialog.Footer>
				<Button type="submit">Save key</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- Rotate key -->
<Dialog.Root
	open={rotating !== null}
	onOpenChange={(v) => {
		if (!v) rotating = null;
	}}
>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Rotate {rotating?.label} key</Dialog.Title>
			<Dialog.Description
				>Replace the stored key. The endpoint and label are unchanged.</Dialog.Description
			>
		</Dialog.Header>
		<form
			method="post"
			action="?/rotate"
			class="space-y-4"
			use:enhance={() =>
				async ({ update }) =>
					update()}
		>
			<input type="hidden" name="id" value={rotating?.id} />
			<div class="space-y-2">
				<Label for="rotate-secret">New API key</Label>
				<Input
					id="rotate-secret"
					name="secret"
					type="password"
					placeholder="sk-…"
					autocomplete="off"
					required
				/>
			</div>
			{#if form?.message}
				<p class="text-sm text-destructive">{form.message}</p>
			{/if}
			<Dialog.Footer>
				<Button type="submit">Rotate key</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- Edit details -->
<Dialog.Root
	open={editingMeta !== null}
	onOpenChange={(v) => {
		if (!v) editingMeta = null;
	}}
>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{editingMeta?.label || 'Provider'} details</Dialog.Title>
			<Dialog.Description
				>Update the label, endpoint and priority. The stored key is unchanged.</Dialog.Description
			>
		</Dialog.Header>
		<form
			method="post"
			action="?/editMeta"
			class="space-y-4"
			use:enhance={() =>
				async ({ update }) =>
					update()}
		>
			<input type="hidden" name="id" value={editingMeta?.id} />
			<input type="hidden" name="provider" value={editingMeta?.provider} />
			{#if editingMeta?.requiresEndpoint}
				<div class="space-y-2">
					<Label for="meta-baseUrl">Endpoint URL</Label>
					<Input
						id="meta-baseUrl"
						name="baseUrl"
						type="url"
						placeholder="https://my-resource.openai.azure.com"
						value={editingMeta?.baseUrl ?? ''}
						autocomplete="off"
						required
					/>
				</div>
			{/if}
			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-2">
					<Label for="meta-label">Label</Label>
					<Input
						id="meta-label"
						name="label"
						value={editingMeta?.label ?? ''}
						placeholder="e.g. Azure East US"
					/>
				</div>
				<div class="space-y-2">
					<Label for="meta-priority">Priority</Label>
					<Input
						id="meta-priority"
						name="priority"
						type="number"
						value={editingMeta?.priority ?? 0}
					/>
				</div>
			</div>
			{#if form?.message}
				<p class="text-sm text-destructive">{form.message}</p>
			{/if}
			<Dialog.Footer>
				<Button type="submit">Save details</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
