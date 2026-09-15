<script lang="ts">
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';

	// A labelled on/off setting. The Switch itself doesn't submit, so a hidden
	// field carries the value as "true"/"false" under `name`.

	let {
		name,
		label,
		checked = $bindable(false)
	}: { name: string; label: string; checked?: boolean } = $props();
</script>

<input type="hidden" {name} value={String(checked)} />

<div class="flex items-center justify-between gap-4">
	<Label for={name}>{label}</Label>
	<Switch id={name} bind:checked />
</div>
