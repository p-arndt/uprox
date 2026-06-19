<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import ConfirmAction from '$lib/components/confirm-action.svelte';
	import { relativeTime } from '$lib/format';
	import { tokenStatus, type Token } from '$lib/tokens';
	import Ban from '@lucide/svelte/icons/ban';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Eye from '@lucide/svelte/icons/eye';

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
	// ghost icon buttons stay hidden until the row is hovered or focused within
	const hoverBtn =
		'size-8 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100';
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
	<Table.Cell class="text-muted-foreground">{token.serviceName}</Table.Cell>
	<Table.Cell>
		{#if token.scopes.length === 0}
			<Badge variant="outline">all</Badge>
		{:else}
			<div class="flex flex-wrap gap-1">
				{#each token.scopes as s (s)}<Badge variant="outline">{s}</Badge>{/each}
			</div>
		{/if}
	</Table.Cell>
	<Table.Cell>
		{#if token.policyId}
			<Badge variant="secondary">{token.policyName}</Badge>
		{:else}
			<span class="text-xs text-muted-foreground">service policy</span>
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
		{#if !token.revokedAt && canManage}
			<div class="flex items-center justify-end gap-0.5">
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
			</div>
		{/if}
	</Table.Cell>
</Table.Row>
