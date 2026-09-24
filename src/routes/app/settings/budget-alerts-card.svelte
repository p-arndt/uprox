<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import BellRing from '@lucide/svelte/icons/bell-ring';
	import SettingsCard from './settings-card.svelte';
	import SwitchField from './switch-field.svelte';
	import type { PageData } from './$types';

	let { settings }: { settings: PageData['settings'] } = $props();

	// Writable derived: the Switch flips it locally and a reload re-syncs it.
	let alertsOn = $derived(settings.budgetAlertsEnabled);
</script>

<SettingsCard
	icon={BellRing}
	title="Budget alerts"
	description="Email owners & admins when a service nears or exceeds its budget."
	action="updateBudgetAlerts"
	savedMessage="Budget alerts saved"
>
	<SwitchField name="budgetAlertsEnabled" label="Enable budget alerts" bind:checked={alertsOn} />

	<div class="space-y-2" class:opacity-50={!alertsOn}>
		<Label for="budgetAlertThresholdPct">Warn threshold (% of budget)</Label>
		<Input
			id="budgetAlertThresholdPct"
			name="budgetAlertThresholdPct"
			type="number"
			min="1"
			max="100"
			value={settings.budgetAlertThresholdPct}
			class="max-w-xs"
			disabled={!alertsOn}
		/>
		<p class="text-xs text-muted-foreground">
			A service is flagged once its daily or monthly spend reaches this share of the ceiling, and
			again when it goes over. Each level emails once per window.
		</p>
	</div>

	<div class="space-y-2" class:opacity-50={!alertsOn}>
		<Label for="budgetAlertEmail">Notification email (optional)</Label>
		<Input
			id="budgetAlertEmail"
			name="budgetAlertEmail"
			type="email"
			placeholder="team@example.com"
			value={settings.budgetAlertEmail ?? ''}
			class="max-w-xs"
			disabled={!alertsOn}
		/>
		<p class="text-xs text-muted-foreground">
			Sent in addition to owners &amp; admins. Requires SMTP to be configured; otherwise the in-app
			banner is the only signal.
		</p>
	</div>
</SettingsCard>
