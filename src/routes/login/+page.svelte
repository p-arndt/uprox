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
	let mode = $state<'signIn' | 'signUp'>('signIn');
	let loading = $state(false);

	// Keep the failed form's mode selected after a server-side validation error.
	$effect(() => {
		if (form?.mode === 'signUp' || form?.mode === 'signIn') mode = form.mode;
	});

	const features = [
		{ icon: KeyRound, text: 'Issue scoped, revocable machine tokens' },
		{ icon: Boxes, text: 'One OpenAI-compatible gateway for every provider' },
		{ icon: ScrollText, text: 'Policy enforcement and full audit trail' }
	];
</script>

<svelte:head><title>{mode === 'signIn' ? 'Sign in' : 'Create account'} · uprox</title></svelte:head>

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
				<h2 class="text-2xl font-semibold tracking-tight">
					{mode === 'signIn' ? 'Welcome back' : 'Create your account'}
				</h2>
				<p class="text-sm text-muted-foreground">
					{mode === 'signIn'
						? 'Sign in to manage your services and tokens.'
						: 'Spin up an organization in seconds.'}
				</p>
			</div>

			<form
				method="post"
				action={mode === 'signIn' ? '?/signIn' : '?/signUp'}
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
				{#if mode === 'signUp'}
					<div class="space-y-2">
						<Label for="name">Name</Label>
						<Input
							id="name"
							name="name"
							placeholder="Ada Lovelace"
							value={form?.name ?? ''}
							required
						/>
					</div>
				{/if}
				<div class="space-y-2">
					<Label for="email">Email</Label>
					<Input
						id="email"
						name="email"
						type="email"
						placeholder="you@company.com"
						value={form?.email ?? ''}
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
					{mode === 'signIn' ? 'Sign in' : 'Create account'}
				</Button>
			</form>

			<p class="text-center text-sm text-muted-foreground">
				{mode === 'signIn' ? "Don't have an account?" : 'Already have an account?'}
				<button
					type="button"
					class="font-medium text-foreground underline-offset-4 hover:underline"
					onclick={() => (mode = mode === 'signIn' ? 'signUp' : 'signIn')}
				>
					{mode === 'signIn' ? 'Sign up' : 'Sign in'}
				</button>
			</p>
		</div>
	</div>
</div>
