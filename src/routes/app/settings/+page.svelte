<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { can } from '$lib/permissions';
	import DatabaseZap from '@lucide/svelte/icons/database-zap';
	import Users from '@lucide/svelte/icons/users';

	let { data, form } = $props();

	// Seeded once from server data; the $effect below re-syncs after reloads.
	let tokensOn = $state(untrack(() => data.settings.membersCanManageTokens));
	let servicesOn = $state(untrack(() => data.settings.membersCanManageServices));

	const canManageSettings = $derived(can(data.role, 'settings:manage', data.memberPermissions));

	// Keep toggles in sync when settings are reloaded (e.g. after invalidateAll).
	$effect(() => {
		tokensOn = data.settings.membersCanManageTokens;
		servicesOn = data.settings.membersCanManageServices;
	});

	$effect(() => {
		if (form?.success) {
			toast.success('Settings saved');
			invalidateAll();
		}
	});
</script>

<div class="mx-auto max-w-2xl space-y-6">
	<div>
		<h2 class="text-xl font-semibold tracking-tight">Settings</h2>
		<p class="text-sm text-muted-foreground">Org-wide gateway defaults.</p>
	</div>

	<Card.Root>
		<Card.Header>
			<div class="flex items-center gap-3">
				<div class="flex size-9 items-center justify-center rounded-lg border bg-muted">
					<DatabaseZap class="size-4" />
				</div>
				<div>
					<Card.Title class="text-base">Response cache</Card.Title>
					<Card.Description>
						Exact-match cache for chat & embeddings, applied to every service.
					</Card.Description>
				</div>
			</div>
		</Card.Header>
		<Card.Content>
			<form
				method="post"
				action="?/updateCache"
				class="space-y-4"
				use:enhance={() =>
					async ({ update }) =>
						update({ reset: false })}
			>
				<div class="space-y-2">
					<Label for="cacheTtlSeconds">Default cache TTL (seconds)</Label>
					<Input
						id="cacheTtlSeconds"
						name="cacheTtlSeconds"
						type="number"
						min="0"
						value={data.settings.cacheTtlSeconds}
						class="max-w-xs"
					/>
					<p class="text-xs text-muted-foreground">
						0 disables caching org-wide. Identical requests within the TTL replay the stored
						response at zero cost (streaming included). A policy can override this per service.
					</p>
				</div>
				<Button type="submit">Save</Button>
			</form>
		</Card.Content>
	</Card.Root>

	{#if canManageSettings}
		<Card.Root>
			<Card.Header>
				<div class="flex items-center gap-3">
					<div class="flex size-9 items-center justify-center rounded-lg border bg-muted">
						<Users class="size-4" />
					</div>
					<div>
						<Card.Title class="text-base">Member permissions</Card.Title>
						<Card.Description>Control what members (not admins/owners) can do.</Card.Description>
					</div>
				</div>
			</Card.Header>
			<Card.Content>
				<form
					method="post"
					action="?/updateMemberPermissions"
					class="space-y-4"
					use:enhance={() =>
						async ({ update }) =>
							update({ reset: false })}
				>
					<input type="hidden" name="membersCanManageTokens" value={String(tokensOn)} />
					<input type="hidden" name="membersCanManageServices" value={String(servicesOn)} />

					<div class="flex items-center justify-between gap-4">
						<Label for="membersCanManageTokens">Members can create &amp; revoke tokens</Label>
						<Switch id="membersCanManageTokens" bind:checked={tokensOn} />
					</div>
					<div class="flex items-center justify-between gap-4">
						<Label for="membersCanManageServices">Members can create services</Label>
						<Switch id="membersCanManageServices" bind:checked={servicesOn} />
					</div>

					<Button type="submit">Save</Button>
				</form>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
