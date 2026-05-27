<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import type { ActionData, PageData } from './$types';
	import { Button } from '$lib/components/ui/button/index.js';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import MailWarning from '@lucide/svelte/icons/mail-warning';
	import Loader2 from '@lucide/svelte/icons/loader-circle';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let loading = $state(false);

	const loginHref = $derived(`/login?redirectTo=${encodeURIComponent(page.url.pathname)}`);
</script>

<svelte:head><title>Invitation · uprox</title></svelte:head>

<div class="flex min-h-svh items-center justify-center bg-muted/30 p-6">
	<div class="w-full max-w-md space-y-8">
		<div class="flex items-center justify-center gap-2 text-lg font-semibold tracking-tight">
			<ShieldCheck class="size-6" /> uprox
		</div>

		<div class="rounded-xl border bg-background p-8 shadow-sm">
			{#if data.invalid}
				<div class="space-y-6 text-center">
					<div
						class="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive"
					>
						<MailWarning class="size-6" />
					</div>
					<div class="space-y-2">
						<h1 class="text-xl font-semibold tracking-tight">Invitation invalid or expired</h1>
						<p class="text-sm text-muted-foreground">{data.reason}</p>
					</div>
					<div class="flex flex-col gap-2">
						<Button href="/app">Go to dashboard</Button>
						<a
							href="/login"
							class="text-sm text-muted-foreground underline-offset-4 hover:underline"
						>
							Back to sign in
						</a>
					</div>
				</div>
			{:else if data.invitation}
				<div class="space-y-6">
					<div class="space-y-2 text-center">
						<h1 class="text-xl font-semibold tracking-tight">You've been invited</h1>
						<p class="text-sm text-muted-foreground">
							Join <span class="font-medium text-foreground">{data.invitation.organizationName}</span>
							as <span class="font-medium text-foreground">{data.invitation.role}</span>.
						</p>
					</div>

					{#if data.loggedIn}
						{#if data.userEmail}
							<p class="text-center text-sm text-muted-foreground">
								Signed in as <span class="font-medium text-foreground">{data.userEmail}</span>
							</p>
						{/if}

						<form
							method="post"
							action="?/accept"
							use:enhance={() => {
								loading = true;
								return async ({ update }) => {
									await update();
									loading = false;
								};
							}}
							class="space-y-3"
						>
							{#if form?.message}
								<p class="text-sm text-destructive">{form.message}</p>
							{/if}
							<Button type="submit" class="w-full" disabled={loading}>
								{#if loading}<Loader2 class="size-4 animate-spin" />{/if}
								Accept invitation
							</Button>
						</form>

						<p class="text-center text-sm text-muted-foreground">
							Not your account?
							<a
								href={loginHref}
								class="font-medium text-foreground underline-offset-4 hover:underline"
							>
								Use a different account
							</a>
						</p>
					{:else}
						<p class="text-center text-sm text-muted-foreground">
							Sign in or create an account to accept this invitation.
						</p>
						<Button href={loginHref} class="w-full">Sign in to continue</Button>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>
