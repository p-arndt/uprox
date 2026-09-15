<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import DollarSign from '@lucide/svelte/icons/dollar-sign';
	import SettingsCard from './settings-card.svelte';
	import type { PageData } from './$types';

	let { settings }: { settings: PageData['settings'] } = $props();
</script>

<SettingsCard
	icon={DollarSign}
	title="Instance budget"
	description="A spend ceiling across every service and token. Enforced on top of per-service and per-token budgets."
	action="updateInstanceBudget"
>
	<div class="grid max-w-md grid-cols-2 gap-3">
		<div class="space-y-2">
			<Label for="dailyBudgetUsd">Daily ceiling (USD)</Label>
			<Input
				id="dailyBudgetUsd"
				name="dailyBudgetUsd"
				type="number"
				min="0"
				step="0.01"
				placeholder="unlimited"
				value={settings.dailyBudgetUsd ?? ''}
			/>
		</div>
		<div class="space-y-2">
			<Label for="monthlyBudgetUsd">Monthly ceiling (USD)</Label>
			<Input
				id="monthlyBudgetUsd"
				name="monthlyBudgetUsd"
				type="number"
				min="0"
				step="0.01"
				placeholder="unlimited"
				value={settings.monthlyBudgetUsd ?? ''}
			/>
		</div>
	</div>
	<p class="text-xs text-muted-foreground">
		Summed from the audit log over UTC windows (daily resets at 00:00, monthly on the 1st). Leave
		blank or 0 for unlimited. Once a window's total reaches the ceiling, further requests are denied
		with a 402 until the window resets.
	</p>
</SettingsCard>
