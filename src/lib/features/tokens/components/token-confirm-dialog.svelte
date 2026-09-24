<script lang="ts">
	import { enhance } from '$app/forms';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';

	// A controlled confirm for revoke/delete. Unlike ConfirmAction it has no
	// trigger of its own, so a dropdown menu item can open it, and it tracks the
	// request so the confirm button can't be pressed twice.

	let {
		open = $bindable(false),
		action,
		tokenId,
		title,
		description,
		actionLabel,
		pendingLabel
	}: {
		open?: boolean;
		/** the form action to POST on confirm, e.g. '?/revoke' */
		action: string;
		/** sent as the hidden `id`; omit on the detail page, whose route carries it */
		tokenId?: string;
		title: string;
		description: string;
		actionLabel: string;
		/** confirm label while the request runs, e.g. "Revoking…" */
		pendingLabel: string;
	} = $props();

	let pending = $state(false);
</script>

<AlertDialog.Root
	bind:open={
		() => open,
		(v) => {
			// closing mid-request would hide whether it worked
			if (!pending) open = v;
		}
	}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{title}</AlertDialog.Title>
			<AlertDialog.Description>{description}</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={pending}>Cancel</AlertDialog.Cancel>
			<form
				method="post"
				{action}
				use:enhance={() => {
					pending = true;
					return async ({ update }) => {
						try {
							await update();
						} finally {
							pending = false;
							// the page reports the outcome as a toast
							open = false;
						}
					};
				}}
			>
				{#if tokenId}
					<input type="hidden" name="id" value={tokenId} />
				{/if}
				<AlertDialog.Action type="submit" variant="destructive" disabled={pending}>
					{pending ? pendingLabel : actionLabel}
				</AlertDialog.Action>
			</form>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
