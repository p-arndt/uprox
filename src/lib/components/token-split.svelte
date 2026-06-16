<script lang="ts">
	import { formatTokens } from '$lib/format';
	import ArrowUpFromLine from '@lucide/svelte/icons/arrow-up-from-line';
	import ArrowDownToLine from '@lucide/svelte/icons/arrow-down-to-line';

	let {
		input,
		output,
		note = null
	}: {
		input: number;
		output: number;
		/** when set, replaces the split with this note (e.g. "excludes … embedding") */
		note?: string | null;
	} = $props();

	const total = $derived(input + output);
	const inPct = $derived(total > 0 ? (input / total) * 100 : 0);
</script>

{#if note}
	<p class="mt-2 text-xs text-muted-foreground tabular-nums">{note}</p>
{:else}
	<div class="mt-2 space-y-1.5">
		<!-- input vs output proportion of the total -->
		<div class="flex h-1.5 gap-px overflow-hidden rounded-full bg-muted">
			<div style="width: {inPct}%; background-color: var(--color-chart-2)"></div>
			<div class="flex-1" style="background-color: var(--color-chart-4)"></div>
		</div>
		<div class="flex justify-between text-xs tabular-nums">
			<span class="flex items-center gap-1">
				<ArrowUpFromLine class="size-3 text-muted-foreground" />
				<span class="font-medium">{formatTokens(input)}</span>
				<span class="text-muted-foreground">in</span>
			</span>
			<span class="flex items-center gap-1">
				<span class="font-medium">{formatTokens(output)}</span>
				<span class="text-muted-foreground">out</span>
				<ArrowDownToLine class="size-3 text-muted-foreground" />
			</span>
		</div>
	</div>
{/if}
