<script lang="ts">
	import { enhance } from '$app/forms';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import type { Snippet } from 'svelte';

	let {
		trigger,
		title,
		description,
		actionLabel,
		action,
		actionVariant = 'destructive',
		fields
	}: {
		/** renders the opening control; spread the supplied `props` onto your button */
		trigger: Snippet<[{ props: Record<string, unknown> }]>;
		title: string;
		description: string;
		actionLabel: string;
		/** the form action to POST on confirm, e.g. '?/delete' */
		action: string;
		actionVariant?: 'default' | 'destructive';
		/** hidden inputs the action needs (e.g. the row id) */
		fields?: Snippet;
	} = $props();

	let open = $state(false);
	// blocks a second submit while the first is in flight (double-click deletes)
	let pending = $state(false);
</script>

<AlertDialog.Root bind:open>
	<AlertDialog.Trigger>
		{#snippet child({ props })}
			{@render trigger({ props })}
		{/snippet}
	</AlertDialog.Trigger>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{title}</AlertDialog.Title>
			<AlertDialog.Description>{description}</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<form
				method="post"
				{action}
				use:enhance={() => {
					pending = true;
					return async ({ update }) => {
						await update();
						pending = false;
						open = false;
					};
				}}
			>
				{@render fields?.()}
				<AlertDialog.Action type="submit" variant={actionVariant} disabled={pending}>
					{pending ? 'Working…' : actionLabel}
				</AlertDialog.Action>
			</form>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
