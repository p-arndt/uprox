<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import ConfirmAction from '$lib/components/form/confirm-action.svelte';
	import { relativeTime } from '$lib/format';
	import {
		connectionTestToast,
		endpointHost,
		maskedHint,
		type ConnectionTestOutcome,
		type ProviderSecret
	} from '$lib/features/providers/providers';
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
		/** show the test / rotate / edit / remove actions */
		canManage: boolean;
		onRotate: () => void;
		onEdit: () => void;
	} = $props();

	const host = $derived(provider.requiresEndpoint ? endpointHost(secret.baseUrl) : null);

	let testing = $state(false);
	// last test outcome for this row; not persisted, so a reload clears it
	let tested = $state<ConnectionTestOutcome | null>(null);
</script>

<div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
	<div class="min-w-0 space-y-1">
		<div class="flex flex-wrap items-center gap-2">
			<span class="truncate text-sm font-medium">{secret.label || 'Untitled key'}</span>
			{#if host}
				<Badge variant="outline" class="font-mono text-xs">{host}</Badge>
			{/if}
			{#if showPriority}
				<Badge variant="secondary" class="text-xs">priority {secret.priority}</Badge>
			{/if}
			{#if tested?.status === 'ok'}
				<Badge variant="secondary" class="text-xs">Connected</Badge>
			{:else if tested?.status === 'failed'}
				<Badge variant="destructive" class="text-xs" title={tested.message}>Test failed</Badge>
			{/if}
		</div>
		<div class="flex items-center gap-2 text-xs text-muted-foreground">
			<Lock class="size-3" />
			<code>{maskedHint(secret.hint)}</code>
			<span>· updated {relativeTime(secret.updatedAt)}</span>
		</div>
	</div>
	{#if canManage}
		<div class="flex shrink-0 flex-wrap items-center gap-1">
			<form
				method="post"
				action="?/test"
				use:enhance={() => {
					testing = true;
					// the result only feeds this row: no page update or invalidation
					return async ({ result }) => {
						testing = false;
						if (result.type === 'success' && result.data?.result) {
							tested = result.data.result as ConnectionTestOutcome;
							const t = connectionTestToast(tested);
							if (t.kind === 'success') toast.success(t.message);
							else if (t.kind === 'error') toast.error(t.message);
							else toast.info(t.message);
						} else if (result.type === 'failure') {
							toast.error(String(result.data?.message ?? 'Test failed'));
						} else if (result.type === 'error') {
							toast.error(result.error?.message ?? 'Test failed');
						}
					};
				}}
			>
				<input type="hidden" name="id" value={secret.id} />
				<Button type="submit" variant="outline" size="sm" disabled={testing}>
					{testing ? 'Testing…' : 'Test'}
				</Button>
			</form>
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
						aria-label="Remove key"
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
