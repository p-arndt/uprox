<script lang="ts">
	import EntityDialog from '$lib/components/entity-dialog.svelte';
	import PolicyForm, { type PolicyFormValues } from '$lib/components/policy-form.svelte';

	let {
		editing,
		providers,
		onClose
	}: {
		/** the preset being edited, or null when the dialog is closed */
		editing: PolicyFormValues | null;
		providers: { id: string; label: string }[];
		onClose: () => void;
	} = $props();
</script>

<EntityDialog
	open={editing !== null}
	{onClose}
	title="Edit preset"
	description="Changes apply to every service and token that inherits this preset."
	class="max-h-[88vh] overflow-y-auto sm:max-w-lg"
>
	{#if editing}
		{#key editing.id}
			<PolicyForm
				{providers}
				action="?/update"
				submitLabel="Save preset"
				idPrefix="edit"
				values={editing}
			/>
		{/key}
	{/if}
</EntityDialog>
