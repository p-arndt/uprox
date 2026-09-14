<script lang="ts">
	// Switch between inspecting call-by-call and reading the whole run.

	let { mode = $bindable('explore') }: { mode?: 'explore' | 'transcript' } = $props();

	const options = [
		{ value: 'explore', label: 'Explore' },
		{ value: 'transcript', label: 'Full transcript' }
	] as const;
</script>

<div class="inline-flex rounded-lg border bg-muted/40 p-0.5 text-xs font-medium">
	{#each options as o (o.value)}
		<button
			type="button"
			onclick={() => (mode = o.value)}
			class="rounded-md px-3 py-1.5 transition-colors {mode === o.value
				? 'bg-background shadow-sm'
				: 'text-muted-foreground hover:text-foreground'}"
		>
			{o.label}
		</button>
	{/each}
</div>
