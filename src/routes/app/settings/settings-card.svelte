<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import FormError from '$lib/components/form/form-error.svelte';

	// One settings section: icon header plus a form posting to a named action.
	// Forms keep their values after submit so a save doesn't blank the inputs.
	// Each card reports its own outcome, so an error lands beside the fields
	// that caused it rather than in a page-wide banner.

	let {
		icon: Icon,
		title,
		description,
		action,
		savedMessage,
		readonly = false,
		children
	}: {
		icon: Component;
		title: string;
		description: string;
		/** the named form action, without the `?/` prefix */
		action: string;
		/** success toast, e.g. "Cache settings saved" */
		savedMessage: string;
		/** show the values without letting the viewer change them */
		readonly?: boolean;
		/** the form fields; the Save button is appended */
		children: Snippet;
	} = $props();

	let pending = $state(false);
	let error = $state<string | null>(null);
</script>

<Card.Root>
	<Card.Header>
		<div class="flex items-center gap-3">
			<div class="flex size-9 items-center justify-center rounded-lg border bg-muted">
				<Icon class="size-4" />
			</div>
			<div>
				<Card.Title class="text-base">{title}</Card.Title>
				<Card.Description>{description}</Card.Description>
			</div>
		</div>
	</Card.Header>
	<Card.Content>
		<form
			method="post"
			action="?/{action}"
			class="space-y-4"
			use:enhance={() => {
				pending = true;
				error = null;
				return async ({ result, update }) => {
					// update() would swap a thrown error (e.g. a 403) for the error
					// page; keep the card and say what went wrong instead.
					if (result.type === 'error') {
						pending = false;
						error = result.error?.message ?? 'Could not save settings';
						return;
					}
					await update({ reset: false });
					pending = false;
					if (result.type === 'success') {
						toast.success(savedMessage);
					} else if (result.type === 'failure') {
						error = (result.data?.message as string | undefined) ?? 'Could not save settings';
					}
				};
			}}
		>
			<!-- A disabled fieldset disables every control inside, the Switch
			     buttons included, without each field needing its own flag. -->
			<fieldset disabled={readonly || pending} class="space-y-4">
				{@render children()}
			</fieldset>
			<FormError message={error} />
			{#if readonly}
				<p class="text-xs text-muted-foreground">Only admins can change settings.</p>
			{:else}
				<Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
			{/if}
		</form>
	</Card.Content>
</Card.Root>
