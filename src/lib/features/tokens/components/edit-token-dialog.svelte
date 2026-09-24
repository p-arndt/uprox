<script lang="ts">
	import TokenForm, {
		type TokenFormValues
	} from '$lib/features/tokens/components/token-form.svelte';
	import EntityDialog from '$lib/components/form/entity-dialog.svelte';
	import type {
		InstanceDefaults,
		PresetLayerRow,
		ServiceLayerRow
	} from '$lib/features/policies/effective-config';

	let {
		editing,
		onClose,
		policies,
		providers,
		services,
		canCreateService = false,
		defaults,
		message
	}: {
		editing: TokenFormValues | null;
		onClose: () => void;
		policies: (PresetLayerRow & { name: string })[];
		providers: { id: string; label: string }[];
		services: (ServiceLayerRow & { name: string; createdAt?: Date | string })[];
		canCreateService?: boolean;
		/** instance defaults, so blank limit fields can show what they inherit */
		defaults?: InstanceDefaults;
		message?: string;
	} = $props();
</script>

<!-- edit token: change its name, service, limits and access in place -->
<EntityDialog
	open={editing !== null}
	{onClose}
	title="Edit token"
	description="Adjust this token's name, service, limits and access. The secret itself never changes."
	class="max-h-[88vh] overflow-y-auto sm:max-w-lg"
>
	{#if editing}
		{#key editing.id}
			<TokenForm
				action="?/update"
				submitLabel="Save token"
				idPrefix="edit"
				values={editing}
				{policies}
				{providers}
				{services}
				{canCreateService}
				{defaults}
				{message}
			/>
		{/key}
	{/if}
</EntityDialog>
