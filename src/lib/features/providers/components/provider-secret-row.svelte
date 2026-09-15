<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import ConfirmAction from '$lib/components/form/confirm-action.svelte';
	import { relativeTime } from '$lib/format';
	import { endpointHost, type ProviderSecret } from '$lib/features/providers/providers';
	import Lock from '@lucide/svelte/icons/lock';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	let {
		secret,
		provider,
		showPriority,
		canManage,
		onRotate,
		onEdit
	}: {
		secret: ProviderSecret;
		/** the provider the secret belongs to; endpoint providers (Azure / custom) show the host */
		provider: { label: string; requiresEndpoint: boolean };
		/** show the priority badge (only when a provider has more than one key) */
		showPriority: boolean;
		/** show the rotate / edit / remove actions */
		canManage: boolean;
		onRotate: () => void;
		onEdit: () => void;
	} = $props();

	const host = $derived(provider.requiresEndpoint ? endpointHost(secret.baseUrl) : null);
</script>

<div class="flex items-center justify-between rounded-lg border px-3 py-2">
	<div class="min-w-0 space-y-1">
		<div class="flex items-center gap-2">
			<span class="truncate text-sm font-medium">{secret.label || 'Untitled key'}</span>
			{#if host}
				<Badge variant="outline" class="font-mono text-xs">{host}</Badge>
			{/if}
			{#if showPriority}
				<Badge variant="secondary" class="text-xs">priority {secret.priority}</Badge>
			{/if}
		</div>
		<div class="flex items-center gap-2 text-xs text-muted-foreground">
			<Lock class="size-3" />
			<code>••••{secret.hint}</code>
			<span>· updated {relativeTime(secret.updatedAt)}</span>
		</div>
	</div>
	{#if canManage}
		<div class="flex shrink-0 items-center gap-1">
			<Button variant="outline" size="sm" onclick={onRotate}>Rotate</Button>
			<Button variant="outline" size="sm" onclick={onEdit}>Edit</Button>
			<ConfirmAction
				action="?/delete"
				title={`Remove this ${provider.label} key?`}
				description={`Services pinned to it fall back to the provider's default key. Any service left without a usable key stops reaching ${provider.label}. The encrypted key is deleted permanently.`}
				actionLabel="Remove key"
			>
				{#snippet trigger({ props })}
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
				{#snippet fields()}
					<input type="hidden" name="id" value={secret.id} />
				{/snippet}
			</ConfirmAction>
		</div>
	{/if}
</div>
