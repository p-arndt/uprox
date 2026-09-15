<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import Waypoints from '@lucide/svelte/icons/waypoints';
	import SettingsCard from './settings-card.svelte';
	import SwitchField from './switch-field.svelte';
	import type { PageData } from './$types';

	let { settings }: { settings: PageData['settings'] } = $props();

	// Writable derived: the Switch flips it locally and a reload re-syncs it.
	let tracingOn = $derived(settings.tracingEnabled);
</script>

<SettingsCard
	icon={Waypoints}
	title="Request tracing"
	description="Capture each request's prompt & response payload for the in-app trace viewer."
	action="updateTracing"
>
	<SwitchField name="tracingEnabled" label="Enable request tracing" bind:checked={tracingOn} />

	<div class="space-y-2" class:opacity-50={!tracingOn}>
		<Label for="tracingRetentionDays">Retention (days)</Label>
		<Input
			id="tracingRetentionDays"
			name="tracingRetentionDays"
			type="number"
			min="1"
			value={settings.tracingRetentionDays}
			class="max-w-xs"
			disabled={!tracingOn}
		/>
		<p class="text-xs text-muted-foreground">
			Traces older than this are pruned automatically. Payloads can contain sensitive prompt data,
			so tracing is off by default; a policy can override it per service.
		</p>
	</div>
</SettingsCard>
