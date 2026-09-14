<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import Loader2 from '@lucide/svelte/icons/loader-circle';
	import AuthShell from '$lib/components/auth-shell.svelte';
	import OidcSignInForm from '$lib/components/oidc-sign-in-form.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let loading = $state(false);

	const providers = $derived(data.enabledProviders);
</script>

<svelte:head><title>Set up uprox</title></svelte:head>

<AuthShell title="Welcome to uprox">
	{#snippet description()}
		{#if providers.email && providers.oidc}
			Create the administrator account, or sign in with SSO to bootstrap. The first account owns the
			first organization.
		{:else if providers.email}
			Create the administrator account. This is a one-time step — this account will own the first
			organization.
		{:else if providers.oidc}
			Sign in with SSO to bootstrap uprox. The first account to sign in owns the first organization.
		{:else}
			First-run setup.
		{/if}
	{/snippet}

	{#if providers.oidc}
		<OidcSignInForm
			label={data.oidcLabel ?? 'SSO'}
			divider={providers.email ? 'after' : undefined}
		/>
	{/if}

	{#if providers.email}
		<form
			method="post"
			action="?/signUp"
			use:enhance={() => {
				loading = true;
				return async ({ update }) => {
					await update();
					loading = false;
				};
			}}
			class="space-y-4"
		>
			<div class="space-y-2">
				<Label for="name">Name</Label>
				<Input
					id="name"
					name="name"
					placeholder="Ada Lovelace"
					value={form && 'name' in form ? form.name : ''}
					required
				/>
			</div>
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
			<div class="space-y-2">
				<Label for="confirmPassword">Confirm password</Label>
				<Input
					id="confirmPassword"
					name="confirmPassword"
					type="password"
					placeholder="••••••••"
					required
				/>
			</div>

			{#if form?.message}
				<p class="text-sm text-destructive">{form.message}</p>
			{/if}

			<Button type="submit" class="w-full" disabled={loading}>
				{#if loading}<Loader2 class="size-4 animate-spin" />{/if}
				Create admin account
			</Button>
		</form>
	{:else if !providers.oidc}
		<div class="space-y-3 rounded-lg border border-border bg-muted/40 p-4">
			<p class="text-sm font-medium">No sign-in methods are enabled</p>
			<p class="text-sm text-muted-foreground">
				Enable email/password sign-up or configure an OIDC provider, then reload this page.
			</p>
		</div>
	{:else if form?.message}
		<p class="text-sm text-destructive">{form.message}</p>
	{/if}
</AuthShell>
