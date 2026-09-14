<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import { enhance } from '$app/forms';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';

	// One settings section: icon header plus a form posting to a named action.
	// Forms keep their values after submit so a save doesn't blank the inputs.

	let {
		icon: Icon,
		title,
		description,
		action,
		children
	}: {
		icon: Component;
		title: string;
		description: string;
		/** the named form action, without the `?/` prefix */
		action: string;
		/** the form fields; the Save button is appended */
		children: Snippet;
	} = $props();
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
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
		>
			{@render children()}
			<Button type="submit">Save</Button>
		</form>
	</Card.Content>
</Card.Root>
