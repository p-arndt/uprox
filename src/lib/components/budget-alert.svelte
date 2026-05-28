<script lang="ts">
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { budgetWarnings, type BudgetStatus } from '$lib/budget';
	import { formatUsd } from '$lib/format';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	// `threshold` (0–1) defaults to the shared warn threshold; pages pass the
	// org's configured budget-alert threshold so the banner matches the emails.
	let { statuses, threshold }: { statuses: BudgetStatus[]; threshold?: number } = $props();

	const warnings = $derived(budgetWarnings(statuses, threshold));
	const anyOver = $derived(warnings.some((w) => w.level === 'over'));
</script>

{#if warnings.length > 0}
	<Alert.Root variant={anyOver ? 'destructive' : 'default'}>
		<TriangleAlert />
		<Alert.Title>
			{anyOver ? 'Service over budget' : 'Service approaching budget'}
		</Alert.Title>
		<Alert.Description>
			<ul class="mt-1 space-y-1.5">
				{#each warnings as w (w.serviceId + w.window)}
					{@const pct = Math.round(w.fraction * 100)}
					<li class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
						<span class="font-medium text-foreground">{w.serviceName}</span>
						<span
							class="font-semibold tabular-nums {w.level === 'over'
								? 'text-destructive'
								: 'text-amber-600 dark:text-amber-400'}"
						>
							{pct}%
						</span>
						<span class="text-muted-foreground">
							of {w.window} budget — {formatUsd(w.spentUsd)} of {formatUsd(w.budgetUsd)}
							<span class="opacity-70">· {w.policyName}</span>
						</span>
					</li>
				{/each}
			</ul>
		</Alert.Description>
	</Alert.Root>
{/if}
