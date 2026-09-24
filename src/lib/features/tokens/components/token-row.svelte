<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import ConfirmAction from '$lib/components/form/confirm-action.svelte';
	import { relativeTime } from '$lib/format';
	import { scopeBadges } from '$lib/scopes';
	import { tokenStatus, type Token } from '$lib/features/tokens/tokens';
	import { tokenPresetLabel } from '$lib/features/tokens/token-helpers';
	import Ban from '@lucide/svelte/icons/ban';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Eye from '@lucide/svelte/icons/eye';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	let {
		token,
		canManage,
		onEdit
	}: {
		token: Token;
		canManage: boolean;
		onEdit: (token: Token) => void;
	} = $props();

	const st = $derived(tokenStatus(token));
	// always visible (touch has no hover), muted until the row is hovered
	const hoverBtn =
		'size-8 text-muted-foreground/70 transition-colors group-hover:text-muted-foreground hover:text-foreground';
	const preset = $derived(tokenPresetLabel(token));
</script>

<Table.Row class="group transition-colors hover:bg-accent/40">
	<Table.Cell class="font-medium">
		<a href={resolve('/app/tokens/[id]', { id: token.id })} class="hover:underline">
			{token.name}
		</a>
	</Table.Cell>
	<Table.Cell>
		<span
			title="Token prefix (the full token is shown only once at creation)"
			class="inline-flex items-center rounded-md bg-muted/60 px-2 py-1 font-mono text-xs text-muted-foreground"
		>
			{token.display}
		</span>
	</Table.Cell>
	<Table.Cell class="text-muted-foreground">
		<a href={resolve('/app/services/[id]', { id: token.serviceId })} class="hover:underline">
			{token.serviceName}
		</a>
	</Table.Cell>
	<Table.Cell>
		<div class="flex flex-wrap gap-1">
			{#each scopeBadges(token.scopes) as s (s)}<Badge variant="outline">{s}</Badge>{/each}
		</div>
	</Table.Cell>
	<Table.Cell>
		{#if preset.source === 'token'}
			<Badge variant="secondary">{preset.name}</Badge>
		{:else if preset.source === 'service'}
			<span class="text-xs text-muted-foreground" title="Inherited from the token's service">
				{preset.name} (from service)
			</span>
		{:else}
			<span class="text-xs text-muted-foreground">—</span>
		{/if}
		{#if token.allowedModels.length > 0}
			<div class="mt-1 flex flex-wrap gap-1">
				{#each token.allowedModels as m (m)}
					<Badge variant="outline" class="font-mono text-[10px]">{m}</Badge>
				{/each}
			</div>
		{/if}
	</Table.Cell>
	<Table.Cell class="text-muted-foreground">{relativeTime(token.lastUsedAt)}</Table.Cell>
	<Table.Cell>
		<span class="inline-flex items-center gap-1.5 text-sm capitalize">
			<span class="size-1.5 rounded-full {st.dot} {st.pulse ? 'dot-pulse' : ''}"></span>
			{st.label}
		</span>
	</Table.Cell>
	<Table.Cell>
		{#if canManage}
			<div class="flex items-center justify-end gap-0.5">
				{#if !token.revokedAt}
					{#if token.recopyable}
						<form
							method="post"
							action="?/reveal"
							use:enhance={() =>
								async ({ update }) =>
									update({ reset: false })}
						>
							<input type="hidden" name="id" value={token.id} />
							<Button
								type="submit"
								variant="ghost"
								size="icon"
								class={hoverBtn}
								title="Reveal & copy token"
							>
								<Eye class="size-4" />
							</Button>
						</form>
					{/if}
					<Button
						variant="ghost"
						size="icon"
						class={hoverBtn}
						title="Edit token"
						onclick={() => onEdit(token)}
					>
						<Pencil class="size-4" />
					</Button>
					<ConfirmAction
						action="?/revoke"
						title={`Revoke “${token.name}”?`}
						description="Any service still using this token will immediately fail to authenticate. This can't be undone."
						actionLabel="Revoke token"
					>
						{#snippet trigger({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon"
								class="{hoverBtn} hover:text-destructive"
								title="Revoke token"
							>
								<Ban class="size-4" />
							</Button>
						{/snippet}
						{#snippet fields()}
							<input type="hidden" name="id" value={token.id} />
						{/snippet}
					</ConfirmAction>
				{/if}
				<ConfirmAction
					action="?/delete"
					title={`Delete “${token.name}”?`}
					description="This permanently removes the token and its configuration. Audit-log history is kept but no longer linked to this token. This can't be undone."
					actionLabel="Delete token"
				>
					{#snippet trigger({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon"
							class="{hoverBtn} hover:text-destructive"
							title="Delete token permanently"
						>
							<Trash2 class="size-4" />
						</Button>
					{/snippet}
					{#snippet fields()}
						<input type="hidden" name="id" value={token.id} />
					{/snippet}
				</ConfirmAction>
			</div>
		{/if}
	</Table.Cell>
</Table.Row>
