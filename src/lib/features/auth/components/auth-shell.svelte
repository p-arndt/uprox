<script lang="ts">
	import type { Snippet } from 'svelte';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Boxes from '@lucide/svelte/icons/boxes';
	import ScrollText from '@lucide/svelte/icons/scroll-text';

	// The split-screen frame shared by the sign-in and first-run setup pages: a
	// brand panel with the feature pitch on large screens, and the form column.

	let {
		title,
		description,
		children
	}: {
		title: string;
		/** the lede under the heading */
		description: Snippet;
		/** the sign-in forms */
		children: Snippet;
	} = $props();

	const features = [
		{ icon: KeyRound, text: 'Issue scoped, revocable machine tokens' },
		{ icon: Boxes, text: 'One OpenAI-compatible gateway for every provider' },
		{ icon: ScrollText, text: 'Policy enforcement and full audit trail' }
	];
</script>

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
				<h2 class="text-2xl font-semibold tracking-tight">{title}</h2>
				<p class="text-sm text-muted-foreground">{@render description()}</p>
			</div>

			{@render children()}
		</div>
	</div>
</div>
