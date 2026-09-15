<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button/index.js';
	import LogIn from '@lucide/svelte/icons/log-in';
	import Loader2 from '@lucide/svelte/icons/loader-circle';

	// The "Sign in with <provider>" button posting to the page's `?/oidc` action,
	// plus the optional "or" divider that separates it from the email form.

	let {
		label,
		redirectTo,
		divider
	}: {
		/** the provider's display name */
		label: string;
		/** posted as `redirectTo` when set */
		redirectTo?: string;
		/** where to render the "or" divider relative to the button, if at all */
		divider?: 'before' | 'after';
	} = $props();

	let loading = $state(false);
</script>

{#snippet or()}
	<div class="flex items-center gap-3">
		<span class="h-px flex-1 bg-border"></span>
		<span class="text-xs text-muted-foreground uppercase">or</span>
		<span class="h-px flex-1 bg-border"></span>
	</div>
{/snippet}

{#if divider === 'before'}{@render or()}{/if}

<form
	method="post"
	action="?/oidc"
	use:enhance={() => {
		loading = true;
		return async ({ update }) => {
			await update();
			loading = false;
		};
	}}
>
	{#if redirectTo !== undefined}
		<input type="hidden" name="redirectTo" value={redirectTo} />
	{/if}
	<Button type="submit" variant="outline" class="w-full" disabled={loading}>
		{#if loading}<Loader2 class="size-4 animate-spin" />{:else}<LogIn class="size-4" />{/if}
		Sign in with {label}
	</Button>
</form>

{#if divider === 'after'}{@render or()}{/if}
