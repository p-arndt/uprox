<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Boxes from '@lucide/svelte/icons/boxes';
	import ScrollText from '@lucide/svelte/icons/scroll-text';
	import Loader2 from '@lucide/svelte/icons/loader-circle';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let loading = $state(false);

	const features = [
		{ icon: KeyRound, text: 'Issue scoped, revocable machine tokens' },
		{ icon: Boxes, text: 'One OpenAI-compatible gateway for every provider' },
		{ icon: ScrollText, text: 'Policy enforcement and full audit trail' }
	];
</script>

<svelte:head><title>Set up uprox</title></svelte:head>

<div class="grid min-h-svh lg:grid-cols-2">
	<!-- brand panel -->
	<div
		class="relative hidden flex-col justify-between overflow-hidden bg-foreground p-12 text-background lg:flex"
	>
		<div
			class="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-background/5 blur-2xl"
		></div>
		<div
			class="pointer-events-none absolute -bottom-32 -left-20 size-96 rounded-full bg-background/5 blur-2xl"
		></div>
		<div class="relative flex items-center gap-2 text-lg font-semibold tracking-tight">
			<ShieldCheck class="size-6" />
			uprox
		</div>
		<div class="relative space-y-6">
			<h1 class="max-w-md text-3xl leading-tight font-semibold tracking-tight">
				The identity &amp; access gateway for your AI workloads.
			</h1>
			<ul class="space-y-3">
				{#each features as f (f.text)}
					<li class="flex items-center gap-3 text-background/80">
						<span class="flex size-9 items-center justify-center rounded-lg bg-background/10">
							<f.icon class="size-4.5" />
						</span>
						{f.text}
					</li>
				{/each}
			</ul>
		</div>
		<p class="relative text-sm text-background/50">Human &amp; machine identity, unified.</p>
	</div>

	<!-- form panel -->
	<div class="flex items-center justify-center p-6 sm:p-12">
		<div class="w-full max-w-sm space-y-8">
			<div class="space-y-2 lg:hidden">
				<div class="flex items-center gap-2 text-lg font-semibold">
					<ShieldCheck class="size-6" /> uprox
				</div>
			</div>

			<div class="space-y-2">
				<h2 class="text-2xl font-semibold tracking-tight">Welcome to uprox</h2>
				<p class="text-sm text-muted-foreground">
					{#if data.emailAuthEnabled}
						Create the administrator account. This is a one-time step — this account will own the
						first organization.
					{:else}
						First-run setup.
					{/if}
				</p>
			</div>

			{#if data.emailAuthEnabled}
				<form
					method="post"
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
			{:else}
				<div class="space-y-3 rounded-lg border border-border bg-muted/40 p-4">
					<p class="text-sm font-medium">Email &amp; password sign-up is disabled</p>
					<p class="text-sm text-muted-foreground">
						The administrator account cannot be created here. Provision the first admin another way
						(for example, by enabling email/password sign-up or configuring your identity provider),
						then reload this page.
					</p>
				</div>
			{/if}
		</div>
	</div>
</div>
