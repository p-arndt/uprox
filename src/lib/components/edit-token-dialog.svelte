<script lang="ts">
	import TokenForm, { type TokenFormValues } from '$lib/components/token-form.svelte';
	import EntityDialog from '$lib/components/entity-dialog.svelte';
	import FormError from '$lib/components/form-error.svelte';

	let {
		editing,
		onClose,
		policies,
		providers,
		services,
		message
	}: {
		editing: TokenFormValues | null;
		onClose: () => void;
		policies: { id: string; name: string }[];
		providers: { id: string; label: string }[];
		services: { id: string; name: string }[];
		message?: string;
	} = $props();
</script>

<!-- edit token: change its policy, model allowlist, scopes, and name in place -->
<EntityDialog
	open={editing !== null}
	{onClose}
	title="Edit token"
	description="Adjust this token's access. The secret itself never changes."
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
			>
				{#snippet bottomFields()}
					<FormError {message} />
				{/snippet}
			</TokenForm>
		{/key}
	{/if}
</EntityDialog>
