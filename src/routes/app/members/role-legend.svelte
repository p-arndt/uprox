<script lang="ts">
	import { resolve } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import type { MemberPermissions } from '$lib/permissions';
	import { memberGrants } from './member-roles';

	// What each role may do, next to the list that assigns them, so nobody has
	// to promote someone to find out.

	let {
		memberPermissions,
		canManageSettings
	}: { memberPermissions: MemberPermissions; canManageSettings: boolean } = $props();

	const grants = $derived(memberGrants(memberPermissions));
</script>

<div class="space-y-3 rounded-xl border p-4 text-sm">
	<h3 class="text-sm font-semibold tracking-tight">Roles</h3>
	<dl class="grid gap-3 sm:grid-cols-[auto_1fr] sm:gap-x-4">
		<dt><Badge variant="default">owner</Badge></dt>
		<dd class="text-muted-foreground">
			Full access. Set up the instance; the role can't be changed or removed here.
		</dd>
		<dt><Badge variant="secondary">admin</Badge></dt>
		<dd class="text-muted-foreground">
			Full access: providers, presets, services, tokens, model prices, settings and members —
			including other admins.
		</dd>
		<dt><Badge variant="outline">member</Badge></dt>
		<dd class="text-muted-foreground">
			Read-only{grants.length ? `, and can currently manage ${grants.join(' and ')}` : ''}.
			{#if canManageSettings}
				Change this under
				<a
					href={resolve('/app/settings')}
					class="font-medium text-foreground underline underline-offset-4"
					>Settings → Member permissions</a
				>.
			{:else}
				Admins set this under Settings → Member permissions.
			{/if}
		</dd>
	</dl>
</div>
