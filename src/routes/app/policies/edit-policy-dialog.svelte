<script lang="ts">
	import EntityDialog from '$lib/components/form/entity-dialog.svelte';
	import PolicyForm, {
		type PolicyFormValues
	} from '$lib/features/policies/components/policy-form.svelte';
	import { editDescription, type PolicyUsage } from './policy-display';

	let {
		editing,
		usage,
		providers,
		modelSuggestions,
		message,
		onClose
	}: {
		/** the preset being edited, or null when the dialog is closed */
		editing: PolicyFormValues | null;
		/** who uses the preset, so the description says who a change reaches */
		usage: PolicyUsage;
		providers: { id: string; label: string }[];
		modelSuggestions: string[];
		/** the update action's error, shown inline while this dialog is open */
		message?: string;
		onClose: () => void;
	} = $props();
</script>

<EntityDialog
	open={editing !== null}
	{onClose}
	title="Edit preset"
	description={editDescription(usage)}
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
				{modelSuggestions}
				{message}
			/>
		{/key}
	{/if}
</EntityDialog>
