<script lang="ts">
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import Info from '@lucide/svelte/icons/info';

	let { text }: { text: string } = $props();
</script>

<!-- inline info affordance: keeps the dense help text out of the form until asked for -->
<Tooltip.Provider delayDuration={120}>
	<Tooltip.Root>
		<Tooltip.Trigger
			type="button"
			class="text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
		>
			<Info class="size-3.5" />
			<span class="sr-only">More information</span>
		</Tooltip.Trigger>
		<Tooltip.Content side="top">{text}</Tooltip.Content>
	</Tooltip.Root>
</Tooltip.Provider>
