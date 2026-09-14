<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import PageHeader from '$lib/components/layout/page-header.svelte';
	import PageShell from '$lib/components/layout/page-shell.svelte';
	import { can } from '$lib/permissions';
	import CacheSettingsCard from './cache-settings-card.svelte';
	import MemberPermissionsCard from './member-permissions-card.svelte';
	import TokenSecurityCard from './token-security-card.svelte';
	import InstanceBudgetCard from './instance-budget-card.svelte';
	import BudgetAlertsCard from './budget-alerts-card.svelte';
	import TracingSettingsCard from './tracing-settings-card.svelte';

	let { data, form } = $props();

	const canManageSettings = $derived(can(data.role, 'settings:manage', data.memberPermissions));

	$effect(() => {
		if (form?.success) {
			toast.success('Settings saved');
			invalidateAll();
		}
	});
</script>

<PageShell width="narrow">
	<PageHeader title="Settings" description="Org-wide gateway defaults." />

	<CacheSettingsCard cacheTtlSeconds={data.settings.cacheTtlSeconds} />

	{#if canManageSettings}
		<MemberPermissionsCard settings={data.settings} />
		<TokenSecurityCard tokensRecopyableDefault={data.settings.tokensRecopyableDefault} />
		<InstanceBudgetCard settings={data.settings} />
		<BudgetAlertsCard settings={data.settings} />
		<TracingSettingsCard settings={data.settings} />
	{/if}
</PageShell>
