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
>
	<SwitchField
		name="membersCanManageTokens"
		label="Members can create & revoke tokens"
		bind:checked={tokensOn}
	/>
	<SwitchField
		name="membersCanManageServices"
		label="Members can create services"
		bind:checked={servicesOn}
	/>
</SettingsCard>
