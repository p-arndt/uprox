<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import Loader2 from '@lucide/svelte/icons/loader-circle';
	import AuthShell from '$lib/features/auth/components/auth-shell.svelte';
	import OidcSignInForm from '$lib/features/auth/components/oidc-sign-in-form.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let loading = $state(false);

	const providers = $derived(data.enabledProviders);
</script>

<svelte:head><title>Sign in · uprox</title></svelte:head>

<AuthShell title="Welcome back">
	{#snippet description()}Sign in to manage your services and tokens.{/snippet}

	{#if providers.oidc}
		<OidcSignInForm
			label={data.oidcLabel ?? 'SSO'}
			redirectTo={data.redirectTo}
			divider={providers.email ? 'after' : undefined}
		/>
	{/if}

	{#if providers.email}
		<form
			method="post"
			action="?/signIn"
			use:enhance={() => {
				loading = true;
				return async ({ update }) => {
					await update();
					loading = false;
				};
			}}
			class="space-y-4"
		>
			<input type="hidden" name="redirectTo" value={data.redirectTo} />
			<div class="space-y-2">
				<Label for="email">Email</Label>
				<Input
					id="email"
					name="email"
					type="email"
					placeholder="you@company.com"
					value={form && 'email' in form ? form.email : ''}
					required
				/>
			</div>
			<div class="space-y-2">
				<Label for="password">Password</Label>
				<Input id="password" name="password" type="password" placeholder="••••••••" required />
			</div>

			{#if form?.message}
				<p class="text-sm text-destructive">{form.message}</p>
			{/if}

			<Button type="submit" class="w-full" disabled={loading}>
				{#if loading}<Loader2 class="size-4 animate-spin" />{/if}
				Sign in
			</Button>
		</form>
	{:else if form?.message}
		<p class="text-sm text-destructive">{form.message}</p>
	{/if}
</AuthShell>
