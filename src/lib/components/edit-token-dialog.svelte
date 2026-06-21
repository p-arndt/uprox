<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import TokenForm, { type TokenFormValues } from '$lib/components/token-form.svelte';

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
<Dialog.Root
	open={editing !== null}
	onOpenChange={(v) => {
		if (!v) onClose();
	}}
>
	<Dialog.Content class="max-h-[88vh] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Edit token</Dialog.Title>
			<Dialog.Description>
				Adjust this token's access. The secret itself never changes.
			</Dialog.Description>
		</Dialog.Header>
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
						{#if message}
							<p class="text-sm text-destructive">{message}</p>
						{/if}
					{/snippet}
				</TokenForm>
			{/key}
		{/if}
	</Dialog.Content>
</Dialog.Root>
