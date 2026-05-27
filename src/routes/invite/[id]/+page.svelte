<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import MailWarning from '@lucide/svelte/icons/mail-warning';
	import LogIn from '@lucide/svelte/icons/log-in';
	import Loader2 from '@lucide/svelte/icons/loader-circle';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let loading = $state(false);
	let registerLoading = $state(false);
	let oidcLoading = $state(false);

	const providers = $derived(data.enabledProviders ?? { email: false, oidc: false });
	const oidcLabel = $derived(data.oidcLabel ?? 'SSO');
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
						<Button href={resolve('/app')}>Go to dashboard</Button>
						<a
							href={resolve('/login')}
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
							Join <span class="font-medium text-foreground"
								>{data.invitation.organizationName}</span
							>
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
								href={resolve('/login')}
								class="font-medium text-foreground underline-offset-4 hover:underline"
							>
								Use a different account
							</a>
						</p>
					{:else}
						{#if providers.email}
							<div class="space-y-2 text-center">
								<p class="text-sm text-muted-foreground">
									Create your account to join
									<span class="font-medium text-foreground">{data.invitation.organizationName}</span
									>.
								</p>
							</div>

							<form
								method="post"
								action="?/register"
								use:enhance={() => {
									registerLoading = true;
									return async ({ update }) => {
										await update();
										registerLoading = false;
									};
								}}
								class="space-y-4"
							>
								<div class="space-y-2">
									<Label for="email">Email</Label>
									<Input id="email" type="email" value={data.invitation.email} disabled />
								</div>
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
									<Label for="password">Password</Label>
									<Input
										id="password"
										name="password"
										type="password"
										placeholder="••••••••"
										required
									/>
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

								<Button type="submit" class="w-full" disabled={registerLoading}>
									{#if registerLoading}<Loader2 class="size-4 animate-spin" />{/if}
									Create account &amp; join
								</Button>
							</form>
						{/if}

						{#if providers.email && providers.oidc}
							<div class="flex items-center gap-3">
								<span class="h-px flex-1 bg-border"></span>
								<span class="text-xs text-muted-foreground uppercase">or</span>
								<span class="h-px flex-1 bg-border"></span>
							</div>
						{/if}

						{#if providers.oidc}
							<form
								method="post"
								action="?/oidc"
								use:enhance={() => {
									oidcLoading = true;
									return async ({ update }) => {
										await update();
										oidcLoading = false;
									};
								}}
							>
								<Button type="submit" variant="outline" class="w-full" disabled={oidcLoading}>
									{#if oidcLoading}<Loader2 class="size-4 animate-spin" />{:else}<LogIn
											class="size-4"
										/>{/if}
									Sign in with {oidcLabel}
								</Button>
							</form>
						{/if}

						{#if !providers.email && providers.oidc && form?.message}
							<p class="text-sm text-destructive">{form.message}</p>
						{/if}

						<p class="text-center text-sm text-muted-foreground">
							Already have an account?
							<a
								href={resolve('/login')}
								class="font-medium text-foreground underline-offset-4 hover:underline"
							>
								Sign in
							</a>
						</p>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>
