<script lang="ts">
	import KeyRound from '@lucide/svelte/icons/key-round';
	import SettingsCard from './settings-card.svelte';
	import SwitchField from './switch-field.svelte';

	let { tokensRecopyableDefault }: { tokensRecopyableDefault: boolean } = $props();

	// Writable derived: the Switch flips it locally and a reload re-syncs it.
	let recopyOn = $derived(tokensRecopyableDefault);
</script>

<SettingsCard
	icon={KeyRound}
	title="Token security"
	description="How machine tokens are stored at rest."
	action="updateTokenSecurity"
>
	<SwitchField
		name="tokensRecopyableDefault"
		label="Allow re-copying new tokens by default"
		bind:checked={recopyOn}
	/>
	<p class="text-xs text-muted-foreground">
		When on, the "Allow re-copying later" box is pre-checked when issuing a token, storing its
		secret encrypted so it can be revealed and copied again. The issuer can still override it per
		token. Off keeps tokens hash-only by default — shown once, then unrecoverable, which is more
		secure (a database leak can't expose them). Existing tokens are unaffected.
	</p>
</SettingsCard>
