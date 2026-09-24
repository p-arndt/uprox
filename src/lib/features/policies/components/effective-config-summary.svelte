<script lang="ts">
	import {
		effectiveConfigRows,
		type ExplainedConfig
	} from '$lib/features/policies/effective-config-view';

	// The resolved limits and access for a token (full cascade) or a service
	// (service → service preset → instance), each with the layer it came from.

	let {
		config,
		subject,
		serviceName,
		providerLabels = {},
		class: className = ''
	}: {
		/** from explainEffectiveConfig (server) */
		config: ExplainedConfig;
		/** whose settings these are; a service view explains the per-token rate */
		subject: 'token' | 'service';
		/** names the service in the shared-budget line */
		serviceName?: string;
		/** provider id → display label */
		providerLabels?: Record<string, string>;
		class?: string;
	} = $props();

	const rows = $derived(effectiveConfigRows(config, { subject, serviceName, providerLabels }));
</script>

<dl class="divide-y text-sm {className}">
	{#each rows as row (row.key)}
		<div class="grid gap-1 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[11rem_1fr] sm:gap-4">
			<dt class="text-muted-foreground">{row.key}</dt>
			<dd class="min-w-0">
				<div class="font-medium break-words">{row.value}</div>
				<div class="text-xs text-muted-foreground">{row.source}</div>
			</dd>
		</div>
	{/each}
</dl>
