<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import PolicyForm, {
		type PolicyFormValues
	} from '$lib/features/policies/components/policy-form.svelte';
	import Plus from '@lucide/svelte/icons/plus';

	// The "New preset" button and its create dialog.

	let {
		open = $bindable(false),
		providers,
		modelSuggestions,
		message
	}: {
		open?: boolean;
		providers: { id: string; label: string }[];
		modelSuggestions: string[];
		/** the create action's error, shown inline while this dialog is open */
		message?: string;
	} = $props();

	const createValues: PolicyFormValues = {
		name: '',
		allowedProviders: [],
		allowedModels: '',
		preferredProvider: '',
		rateLimitPerMinute: 0,
		dailyBudgetUsd: 0,
		monthlyBudgetUsd: 0,
		cacheTtlSeconds: ''
	};
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger>
		{#snippet child({ props })}
			<Button {...props}><Plus class="size-4" /> New preset</Button>
		{/snippet}
	</Dialog.Trigger>
	<Dialog.Content class="max-h-[88vh] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Create preset</Dialog.Title>
			<Dialog.Description>
				Services and tokens that attach this preset start from its values. They can override the
				numbers and narrow the lists, but never widen them.
			</Dialog.Description>
		</Dialog.Header>
		<PolicyForm
			{providers}
			action="?/create"
			submitLabel="Create preset"
			idPrefix="create"
			values={createValues}
			{modelSuggestions}
			{message}
			resetOnSuccess
		/>
	</Dialog.Content>
</Dialog.Root>
