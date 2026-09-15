<script lang="ts">
	import LogIn from '@lucide/svelte/icons/log-in';
	import SettingsCard from './settings-card.svelte';
	import SwitchField from './switch-field.svelte';

	let { ssoSignupEnabled }: { ssoSignupEnabled: boolean } = $props();

	// Writable derived: the Switch flips it locally and a reload re-syncs it.
	let signupOn = $derived(ssoSignupEnabled);
</script>

<SettingsCard
	icon={LogIn}
	title="Single sign-on"
	description="Who may join the instance through SSO."
	action="updateSsoSignup"
>
	<SwitchField
		name="ssoSignupEnabled"
		label="Allow new members to sign up via SSO"
		bind:checked={signupOn}
	/>
	<p class="text-xs text-muted-foreground">
		When on, anyone who can sign in with your identity provider gets an account on first sign-in.
		Off limits SSO to existing members and invited addresses; everyone else is turned away until an
		admin invites them. Existing members are unaffected.
	</p>
</SettingsCard>
