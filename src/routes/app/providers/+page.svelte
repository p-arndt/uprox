<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { relativeTime } from '$lib/format';
	import { can } from '$lib/permissions';
	import Plug from '@lucide/svelte/icons/plug';
	import Lock from '@lucide/svelte/icons/lock';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	let { data, form } = $props();
	let editing = $state<{
		id: string;
		label: string;
		requiresEndpoint: boolean;
		baseUrl: string;
	} | null>(null);
	let editingMeta = $state<{
		id: string;
		provider: string;
		label: string;
		requiresEndpoint: boolean;
		baseUrl: string;
	} | null>(null);

	const byProvider = $derived(new Map(data.secrets.map((s) => [s.provider, s] as const)));
	const canManage = $derived(can(data.role, 'providers:manage', data.memberPermissions));

	$effect(() => {
		if (form?.success) {
			editing = null;
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
			a request.
		</p>
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		{#each data.providers as p (p.id)}
			{@const secret = byProvider.get(p.id)}
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0">
					<div class="flex items-center gap-3">
						<div class="flex size-9 items-center justify-center rounded-lg border bg-muted">
							<Plug class="size-4" />
						</div>
						<div>
							<Card.Title class="text-base">{p.label}</Card.Title>
							<Card.Description class="text-xs">
								{secret?.baseUrl ?? p.baseUrl ?? (p.requiresEndpoint ? 'per-org endpoint' : '')}
							</Card.Description>
						</div>
					</div>
					{#if secret}
						<Badge variant="secondary">configured</Badge>
					{:else}
						<Badge variant="outline">not set</Badge>
					{/if}
				</Card.Header>
				<Card.Content class="flex items-center justify-between">
					{#if secret}
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Lock class="size-3.5" />
							<code>••••{secret.hint}</code>
							<span class="text-xs">· updated {relativeTime(secret.updatedAt)}</span>
						</div>
						{#if canManage}
							<form
								method="post"
								action="?/delete"
								use:enhance={() =>
									async ({ update }) =>
										update()}
							>
								<input type="hidden" name="id" value={secret.id} />
								<Button
									type="submit"
									variant="ghost"
									size="icon"
									class="size-8 text-muted-foreground hover:text-destructive"
									title="Remove key"
								>
									<Trash2 class="size-4" />
								</Button>
							</form>
						{/if}
					{:else}
						<span class="text-sm text-muted-foreground">No key configured</span>
						{#if canManage}
							<Button
								variant="outline"
								size="sm"
								onclick={() =>
									(editing = {
										id: p.id,
										label: p.label,
										requiresEndpoint: p.requiresEndpoint,
										baseUrl: ''
									})}
							>
								Add key
							</Button>
						{/if}
					{/if}
				</Card.Content>
				{#if secret && canManage}
					<Card.Footer class="gap-2">
						<Button
							variant="outline"
							size="sm"
							onclick={() =>
								(editing = {
									id: p.id,
									label: p.label,
									requiresEndpoint: p.requiresEndpoint,
									baseUrl: secret?.baseUrl ?? ''
								})}
						>
							Rotate key
						</Button>
						<Button
							variant="outline"
							size="sm"
							onclick={() =>
								(editingMeta = {
									id: secret.id,
									provider: p.id,
									label: secret.label ?? '',
									requiresEndpoint: p.requiresEndpoint,
									baseUrl: secret.baseUrl ?? ''
								})}
						>
							Edit details
						</Button>
					</Card.Footer>
				{/if}
			</Card.Root>
		{/each}
	</div>
</div>

<Dialog.Root
	open={editing !== null}
	onOpenChange={(v) => {
		if (!v) editing = null;
	}}
>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{editing?.label} API key</Dialog.Title>
			<Dialog.Description
				>Stored encrypted. We only ever show the last 4 characters.</Dialog.Description
			>
		</Dialog.Header>
		<form
			method="post"
			action="?/save"
			class="space-y-4"
			use:enhance={() =>
				async ({ update }) =>
					update()}
		>
			<input type="hidden" name="provider" value={editing?.id} />
			{#if editing?.requiresEndpoint}
				<div class="space-y-2">
					<Label for="baseUrl">Endpoint URL</Label>
					<Input
						id="baseUrl"
						name="baseUrl"
						type="url"
						placeholder="https://my-resource.openai.azure.com"
						value={editing?.baseUrl ?? ''}
						autocomplete="off"
						required
					/>
					<p class="text-xs text-muted-foreground">
						Your Azure resource endpoint. Call models by their deployment name (e.g.
						<code>gpt-4o</code>) — no prefix. Set the preferred backend on a policy when OpenAI is
						also configured.
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
			<div class="space-y-2">
				<Label for="label">Label (optional)</Label>
				<Input id="label" name="label" placeholder="Production key" />
			</div>
			{#if form?.message}
				<p class="text-sm text-destructive">{form.message}</p>
			{/if}
			<Dialog.Footer>
				<Button type="submit">Save key</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

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
				>Update the label and endpoint. The stored key is unchanged.</Dialog.Description
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
					<p class="text-xs text-muted-foreground">
						Your Azure resource endpoint. Call models by their deployment name (e.g.
						<code>gpt-4o</code>) — no prefix. Set the preferred backend on a policy when OpenAI is
						also configured.
					</p>
				</div>
			{/if}
			<div class="space-y-2">
				<Label for="meta-label">Label (optional)</Label>
				<Input
					id="meta-label"
					name="label"
					value={editingMeta?.label ?? ''}
					placeholder="Production key"
				/>
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
