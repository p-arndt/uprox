<script lang="ts">
	// A minimal inline trend line for the headline stat cards — the glanceable
	// per-bucket shape behind a single figure (cf. the OpenAI usage cards). Shares
	// the 0–100 viewBox + non-scaling-stroke approach with the usage charts so it
	// stretches to any width while keeping an even stroke. Purely decorative, so
	// it's aria-hidden; the real numbers live in the card text.

	let {
		values,
		class: className = ''
	}: {
		values: number[];
		class?: string;
	} = $props();

	// Scale to the series peak; flat/empty series collapse to the baseline.
	const peak = $derived(Math.max(0, ...values));
	const n = $derived(values.length);

	function xOf(i: number): number {
		return n > 1 ? (i / (n - 1)) * 100 : 50;
	}
	function yOf(v: number): number {
		return peak > 0 ? 100 - (v / peak) * 100 : 100;
	}

	const linePath = $derived(
		values
			.map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(2)},${yOf(v).toFixed(2)}`)
			.join(' ')
	);
	const areaPath = $derived(
		values.length > 0 ? `${linePath} L${xOf(n - 1).toFixed(2)},100 L${xOf(0).toFixed(2)},100 Z` : ''
	);
	const hasShape = $derived(peak > 0 && n > 1);
</script>

{#if hasShape}
	<svg
		class="w-full {className}"
		viewBox="0 0 100 100"
		preserveAspectRatio="none"
		aria-hidden="true"
	>
		<path d={areaPath} class="fill-chart-1/10" />
		<path
			d={linePath}
			fill="none"
			class="stroke-chart-1/70"
			stroke-width="1.5"
			stroke-linejoin="round"
			stroke-linecap="round"
			vector-effect="non-scaling-stroke"
		/>
	</svg>
{/if}
