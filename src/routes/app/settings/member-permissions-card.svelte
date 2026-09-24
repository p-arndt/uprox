<script lang="ts">
	import Users from '@lucide/svelte/icons/users';
	import SettingsCard from './settings-card.svelte';
	import SwitchField from './switch-field.svelte';
	import type { PageData } from './$types';

	let { settings }: { settings: PageData['settings'] } = $props();

	// Writable deriveds: a Switch flips them locally and a reload re-syncs them.
	let tokensOn = $derived(settings.membersCanManageTokens);
	let servicesOn = $derived(settings.membersCanManageServices);
</script>

<SettingsCard
	icon={Users}
	title="Member permissions"
	description="Control what members (not admins/owners) can do."
	action="updateMemberPermissions"
	savedMessage="Member permissions saved"
>
	<div class="space-y-1">
		<SwitchField
			name="membersCanManageTokens"
			label="Members can manage machine tokens"
			bind:checked={tokensOn}
		/>
		<p class="text-xs text-muted-foreground">
			Create, edit, reveal stored secrets, revoke and delete any token.
		</p>
	</div>
	<div class="space-y-1">
		<SwitchField
			name="membersCanManageServices"
			label="Members can manage services"
			bind:checked={servicesOn}
		/>
		<p class="text-xs text-muted-foreground">
			Create, edit and delete any service. Deleting a service revokes its tokens.
		</p>
	</div>
</SettingsCard>
