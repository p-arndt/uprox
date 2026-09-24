<script lang="ts">
	import TokenForm, {
		type TokenFormValues
	} from '$lib/features/tokens/components/token-form.svelte';
	import EntityDialog from '$lib/components/form/entity-dialog.svelte';

	let {
		editing,
		onClose,
		policies,
		providers,
		services,
		canCreateService = false,
		message
	}: {
		editing: TokenFormValues | null;
		onClose: () => void;
		policies: { id: string; name: string }[];
		providers: { id: string; label: string }[];
		services: { id: string; name: string; createdAt?: Date | string }[];
		canCreateService?: boolean;
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
				{message}
			/>
		{/key}
	{/if}
</EntityDialog>
