<script lang="ts">
	// The server-side validation message under a form; renders nothing without one.
	let { message }: { message?: string | null } = $props();
</script>

{#if message}
	<p class="text-sm text-destructive">{message}</p>
{/if}
