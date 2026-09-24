<script lang="ts">
	import PageHeader from '$lib/components/layout/page-header.svelte';
	import PageShell from '$lib/components/layout/page-shell.svelte';
	import { can } from '$lib/permissions';
	import CacheSettingsCard from './cache-settings-card.svelte';
	import MemberPermissionsCard from './member-permissions-card.svelte';
	import TokenSecurityCard from './token-security-card.svelte';
	import InstanceBudgetCard from './instance-budget-card.svelte';
	import BudgetAlertsCard from './budget-alerts-card.svelte';
	import SsoSignupCard from './sso-signup-card.svelte';

	let { data } = $props();

	const canManageSettings = $derived(can(data.role, 'settings:manage', data.memberPermissions));
</script>

{#snippet heading(title: string, description: string)}
	<div class="pt-2">
		<h2 class="text-sm font-semibold tracking-tight">{title}</h2>
		<p class="text-xs text-muted-foreground">{description}</p>
	</div>
{/snippet}

<PageShell width="narrow">
	<PageHeader title="Settings" description="Org-wide gateway defaults." />

	{#if canManageSettings}
		<section id="access" class="space-y-4">
			{@render heading('Access', 'Who can do what, and how people and tokens get in.')}
			<MemberPermissionsCard settings={data.settings} />
			{#if data.oidcEnabled}
				<SsoSignupCard ssoSignupEnabled={data.settings.ssoSignupEnabled} />
			{/if}
			<TokenSecurityCard tokensRecopyableDefault={data.settings.tokensRecopyableDefault} />
		</section>

		<section id="spend" class="space-y-4">
			{@render heading('Spend', 'Ceilings across the whole instance and who hears about them.')}
			<InstanceBudgetCard settings={data.settings} />
			<BudgetAlertsCard settings={data.settings} />
		</section>
	{/if}

	<section id="performance" class="space-y-4">
		{@render heading('Performance', 'Defaults every service inherits unless its preset overrides.')}
		<CacheSettingsCard
			cacheTtlSeconds={data.settings.cacheTtlSeconds}
			readonly={!canManageSettings}
		/>
	</section>
</PageShell>
