<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { invalidateAll } from '$app/navigation';
	import PageHeader from '$lib/components/page-header.svelte';
	import ProviderSecretRow from '$lib/components/provider-secret-row.svelte';
	import ProviderKeyDialog from '$lib/components/provider-key-dialog.svelte';
	import RotateKeyDialog from '$lib/components/rotate-key-dialog.svelte';
	import EditMetaDialog from '$lib/components/edit-meta-dialog.svelte';
	import type { ProviderSecret } from '$lib/providers';
	import { can } from '$lib/permissions';
	import Plug from '@lucide/svelte/icons/plug';
	import Plus from '@lucide/svelte/icons/plus';

	let { data, form } = $props();

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
		}, new Map<string, ProviderSecret[]>())
	);
	const canManage = $derived(can(data.role, 'providers:manage', data.memberPermissions));

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
	<PageHeader title="Providers">
		{#snippet description()}
			Upstream API keys, encrypted at rest with AES-256-GCM. The gateway decrypts them only to proxy
			a request. A provider can hold several keys — e.g. one per Azure OpenAI resource — and a
			service picks which one it uses.
		{/snippet}
	</PageHeader>

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
							<ProviderSecretRow
								{s}
								label={p.label}
								requiresEndpoint={p.requiresEndpoint}
								showPriority={secrets.length > 1}
								{canManage}
								onRotate={() => (rotating = { id: s.id, label: s.label || p.label })}
								onEdit={() =>
									(editingMeta = {
										id: s.id,
										provider: p.id,
										label: s.label ?? '',
										requiresEndpoint: p.requiresEndpoint,
										baseUrl: s.baseUrl ?? '',
										priority: s.priority
									})}
							/>
						{/each}
					{/if}
				</Card.Content>
			</Card.Root>
		{/each}
	</div>
</div>

<ProviderKeyDialog {adding} message={form?.message} onClose={() => (adding = null)} />
<RotateKeyDialog {rotating} message={form?.message} onClose={() => (rotating = null)} />
<EditMetaDialog {editingMeta} message={form?.message} onClose={() => (editingMeta = null)} />
