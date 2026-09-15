<script lang="ts">
	import { eventTone, toneDot, toneText } from '$lib/events';

	// A gateway call's status as a tone dot plus "status code", e.g. "error 502".

	let { status, statusCode }: { status: string; statusCode?: number | null } = $props();

	const tone = $derived(eventTone(status));
</script>

<span class="flex items-center gap-1.5">
	<span class="size-1.5 rounded-full {toneDot[tone]}" aria-hidden="true"></span>
	<span class="text-xs font-medium {toneText[tone]}">
		{status}{statusCode ? ` ${statusCode}` : ''}
	</span>
</span>
