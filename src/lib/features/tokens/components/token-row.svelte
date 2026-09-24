<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import TokenConfirmDialog from '$lib/features/tokens/components/token-confirm-dialog.svelte';
	import { relativeTime } from '$lib/format';
	import { scopeBadges } from '$lib/scopes';
	import { tokenStatus, type Token } from '$lib/features/tokens/tokens';
	import { tokenPresetLabel } from '$lib/features/tokens/token-helpers';
	import Ban from '@lucide/svelte/icons/ban';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
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
	const preset = $derived(tokenPresetLabel(token));

	let revokeOpen = $state(false);
	let deleteOpen = $state(false);
	// a menu item can't be a submit button, so it submits this form instead
	let revealForm = $state<HTMLFormElement>();
	let revealing = $state(false);
</script>

<Table.Row class="transition-colors hover:bg-accent/40">
	<Table.Cell class="font-medium">
		<a href={resolve('/app/tokens/[id]', { id: token.id })} class="hover:underline">
			{token.name}
		</a>
	</Table.Cell>
	<Table.Cell class="hidden md:table-cell">
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
	<Table.Cell class="hidden md:table-cell">
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
	<Table.Cell class="hidden text-muted-foreground md:table-cell">
		{relativeTime(token.lastUsedAt)}
	</Table.Cell>
	<Table.Cell>
		<span class="inline-flex items-center gap-1.5 text-sm capitalize">
			<span class="size-1.5 rounded-full {st.dot} {st.pulse ? 'dot-pulse' : ''}"></span>
			{st.label}
		</span>
	</Table.Cell>
	<Table.Cell class="text-right">
		{#if canManage}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon"
							class="size-10 text-muted-foreground hover:text-foreground"
							aria-label="Actions for token {token.name}"
						>
							<Ellipsis class="size-4" />
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="min-w-44">
					{#if !token.revokedAt}
						<DropdownMenu.Item onSelect={() => onEdit(token)}>
							<Pencil /> Edit
						</DropdownMenu.Item>
						{#if token.recopyable}
							<DropdownMenu.Item disabled={revealing} onSelect={() => revealForm?.requestSubmit()}>
								<Eye /> Reveal & copy
							</DropdownMenu.Item>
						{/if}
						<DropdownMenu.Separator />
						<DropdownMenu.Item variant="destructive" onSelect={() => (revokeOpen = true)}>
							<Ban /> Revoke
						</DropdownMenu.Item>
					{/if}
					<DropdownMenu.Item variant="destructive" onSelect={() => (deleteOpen = true)}>
						<Trash2 /> Delete
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>

			{#if token.recopyable && !token.revokedAt}
				<form
					bind:this={revealForm}
					method="post"
					action="?/reveal"
					class="hidden"
					use:enhance={() => {
						revealing = true;
						return async ({ update }) => {
							try {
								await update({ reset: false });
							} finally {
								revealing = false;
							}
						};
					}}
				>
					<input type="hidden" name="id" value={token.id} />
				</form>
			{/if}
			<TokenConfirmDialog
				bind:open={revokeOpen}
				action="?/revoke"
				tokenId={token.id}
				title={`Revoke “${token.name}”?`}
				description="Any service still using this token will immediately fail to authenticate. This can't be undone."
				actionLabel="Revoke token"
				pendingLabel="Revoking…"
			/>
			<TokenConfirmDialog
				bind:open={deleteOpen}
				action="?/delete"
				tokenId={token.id}
				title={`Delete “${token.name}”?`}
				description="This permanently removes the token and its configuration. Audit-log history is kept but no longer linked to this token. This can't be undone."
				actionLabel="Delete token"
				pendingLabel="Deleting…"
			/>
		{/if}
	</Table.Cell>
</Table.Row>
