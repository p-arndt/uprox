<script lang="ts">
	import { untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import PageHeader from '$lib/components/page-header.svelte';
	import { can } from '$lib/permissions';
	import DatabaseZap from '@lucide/svelte/icons/database-zap';
	import Users from '@lucide/svelte/icons/users';
	import BellRing from '@lucide/svelte/icons/bell-ring';
	import Waypoints from '@lucide/svelte/icons/waypoints';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import DollarSign from '@lucide/svelte/icons/dollar-sign';
	import PageShell from '$lib/components/page-shell.svelte';
	import SettingsCard from './settings-card.svelte';

	let { data, form } = $props();

	type Settings = typeof data.settings;

	/** The switch-backed settings, mirrored locally so the Switches can bind. */
	function togglesFrom(s: Settings) {
		return {
			membersCanManageTokens: s.membersCanManageTokens,
			membersCanManageServices: s.membersCanManageServices,
			tokensRecopyableDefault: s.tokensRecopyableDefault,
			budgetAlertsEnabled: s.budgetAlertsEnabled,
			tracingEnabled: s.tracingEnabled
		};
	}

	// Seeded once from server data; the $effect below re-syncs after reloads.
	let toggles = $state(untrack(() => togglesFrom(data.settings)));

	const canManageSettings = $derived(can(data.role, 'settings:manage', data.memberPermissions));

	// Keep toggles in sync when settings are reloaded (e.g. after invalidateAll).
	$effect(() => {
		toggles = togglesFrom(data.settings);
	});

	$effect(() => {
		if (form?.success) {
			toast.success('Settings saved');
			invalidateAll();
		}
	});
</script>

<PageShell width="narrow">
	<PageHeader title="Settings" description="Org-wide gateway defaults." />

	<SettingsCard
		icon={DatabaseZap}
		title="Response cache"
		description="Exact-match cache for chat & embeddings, applied to every service."
		action="updateCache"
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
				0 disables caching org-wide. Identical requests within the TTL replay the stored response at
				zero cost (streaming included). A policy can override this per service.
			</p>
		</div>
	</SettingsCard>

	{#if canManageSettings}
		<SettingsCard
			icon={Users}
			title="Member permissions"
			description="Control what members (not admins/owners) can do."
			action="updateMemberPermissions"
		>
			<input
				type="hidden"
				name="membersCanManageTokens"
				value={String(toggles.membersCanManageTokens)}
			/>
			<input
				type="hidden"
				name="membersCanManageServices"
				value={String(toggles.membersCanManageServices)}
			/>

			<div class="flex items-center justify-between gap-4">
				<Label for="membersCanManageTokens">Members can create &amp; revoke tokens</Label>
				<Switch id="membersCanManageTokens" bind:checked={toggles.membersCanManageTokens} />
			</div>
			<div class="flex items-center justify-between gap-4">
				<Label for="membersCanManageServices">Members can create services</Label>
				<Switch id="membersCanManageServices" bind:checked={toggles.membersCanManageServices} />
			</div>
		</SettingsCard>

		<SettingsCard
			icon={KeyRound}
			title="Token security"
			description="How machine tokens are stored at rest."
			action="updateTokenSecurity"
		>
			<input
				type="hidden"
				name="tokensRecopyableDefault"
				value={String(toggles.tokensRecopyableDefault)}
			/>

			<div class="flex items-center justify-between gap-4">
				<Label for="tokensRecopyableDefault">Allow re-copying new tokens by default</Label>
				<Switch id="tokensRecopyableDefault" bind:checked={toggles.tokensRecopyableDefault} />
			</div>
			<p class="text-xs text-muted-foreground">
				When on, the "Allow re-copying later" box is pre-checked when issuing a token, storing its
				secret encrypted so it can be revealed and copied again. The issuer can still override it
				per token. Off keeps tokens hash-only by default — shown once, then unrecoverable, which is
				more secure (a database leak can't expose them). Existing tokens are unaffected.
			</p>
		</SettingsCard>

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
						value={data.settings.dailyBudgetUsd ?? ''}
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
						value={data.settings.monthlyBudgetUsd ?? ''}
					/>
				</div>
			</div>
			<p class="text-xs text-muted-foreground">
				Summed from the audit log over UTC windows (daily resets at 00:00, monthly on the 1st).
				Leave blank or 0 for unlimited. Once a window's total reaches the ceiling, further requests
				are denied with a 402 until the window resets.
			</p>
		</SettingsCard>

		<SettingsCard
			icon={BellRing}
			title="Budget alerts"
			description="Email owners & admins when a service nears or exceeds its policy budget."
			action="updateBudgetAlerts"
		>
			<input type="hidden" name="budgetAlertsEnabled" value={String(toggles.budgetAlertsEnabled)} />

			<div class="flex items-center justify-between gap-4">
				<Label for="budgetAlertsEnabled">Enable budget alerts</Label>
				<Switch id="budgetAlertsEnabled" bind:checked={toggles.budgetAlertsEnabled} />
			</div>

			<div class="space-y-2" class:opacity-50={!toggles.budgetAlertsEnabled}>
				<Label for="budgetAlertThresholdPct">Warn threshold (% of budget)</Label>
				<Input
					id="budgetAlertThresholdPct"
					name="budgetAlertThresholdPct"
					type="number"
					min="1"
					max="100"
					value={data.settings.budgetAlertThresholdPct}
					class="max-w-xs"
					disabled={!toggles.budgetAlertsEnabled}
				/>
				<p class="text-xs text-muted-foreground">
					A service is flagged once its daily or monthly spend reaches this share of the ceiling,
					and again when it goes over. Each level emails once per window.
				</p>
			</div>

			<div class="space-y-2" class:opacity-50={!toggles.budgetAlertsEnabled}>
				<Label for="budgetAlertEmail">Notification email (optional)</Label>
				<Input
					id="budgetAlertEmail"
					name="budgetAlertEmail"
					type="email"
					placeholder="team@example.com"
					value={data.settings.budgetAlertEmail ?? ''}
					class="max-w-xs"
					disabled={!toggles.budgetAlertsEnabled}
				/>
				<p class="text-xs text-muted-foreground">
					Sent in addition to owners &amp; admins. Requires SMTP to be configured; otherwise the
					in-app banner is the only signal.
				</p>
			</div>
		</SettingsCard>

		<SettingsCard
			icon={Waypoints}
			title="Request tracing"
			description="Capture each request's prompt & response payload for the in-app trace viewer."
			action="updateTracing"
		>
			<input type="hidden" name="tracingEnabled" value={String(toggles.tracingEnabled)} />

			<div class="flex items-center justify-between gap-4">
				<Label for="tracingEnabled">Enable request tracing</Label>
				<Switch id="tracingEnabled" bind:checked={toggles.tracingEnabled} />
			</div>

			<div class="space-y-2" class:opacity-50={!toggles.tracingEnabled}>
				<Label for="tracingRetentionDays">Retention (days)</Label>
				<Input
					id="tracingRetentionDays"
					name="tracingRetentionDays"
					type="number"
					min="1"
					value={data.settings.tracingRetentionDays}
					class="max-w-xs"
					disabled={!toggles.tracingEnabled}
				/>
				<p class="text-xs text-muted-foreground">
					Traces older than this are pruned automatically. Payloads can contain sensitive prompt
					data, so tracing is off by default; a policy can override it per service.
				</p>
			</div>
		</SettingsCard>
	{/if}
</PageShell>
