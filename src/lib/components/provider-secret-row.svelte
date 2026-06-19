<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import ConfirmAction from '$lib/components/confirm-action.svelte';
	import { relativeTime } from '$lib/format';
	import { endpointHost, type ProviderSecret } from '$lib/providers';
	import Lock from '@lucide/svelte/icons/lock';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	let {
		s,
		label,
		requiresEndpoint,
		showPriority,
		canManage,
		onRotate,
		onEdit
	}: {
		s: ProviderSecret;
		/** the provider's display label */
		label: string;
		/** whether the provider needs a per-org endpoint (Azure / custom) */
		requiresEndpoint: boolean;
		/** show the priority badge (only when a provider has more than one key) */
		showPriority: boolean;
		canManage: boolean;
		onRotate: () => void;
		onEdit: () => void;
	} = $props();
</script>

<div class="flex items-center justify-between rounded-lg border px-3 py-2">
	<div class="min-w-0 space-y-1">
		<div class="flex items-center gap-2">
			<span class="truncate text-sm font-medium">{s.label || 'Untitled key'}</span>
			{#if requiresEndpoint && endpointHost(s.baseUrl)}
				<Badge variant="outline" class="font-mono text-xs">{endpointHost(s.baseUrl)}</Badge>
			{/if}
			{#if showPriority}
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
			<Button variant="outline" size="sm" onclick={onRotate}>Rotate</Button>
			<Button variant="outline" size="sm" onclick={onEdit}>Edit</Button>
			<ConfirmAction
				action="?/delete"
				title={`Remove this ${label} key?`}
				description={`Services pinned to it fall back to the provider's default key. Any service left without a usable key stops reaching ${label}. The encrypted key is deleted permanently.`}
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
					<input type="hidden" name="id" value={s.id} />
				{/snippet}
			</ConfirmAction>
		</div>
	{/if}
</div>
