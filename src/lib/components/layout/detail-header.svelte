<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	// The identity block at the top of a detail page: what kind of thing this is,
	// what it's called, and the facts that identify it. Services and tokens
	// each grew their own near-copy of this, drifting on icon size, heading
	// level and back-link wording; the up-navigation now lives in the breadcrumb
	// in the app header, so this is purely identity.

	let {
		icon: Icon,
		eyebrow,
		title,
		mono = false,
		badges,
		lede,
		meta,
		extra,
		action
	}: {
		icon: Component;
		/** the entity's type, e.g. "Service" — small caps above the name */
		eyebrow: string;
		title: string;
		/** names that are identifiers (model ids, token ids) read better monospaced */
		mono?: boolean;
		/** status dots, badges and inline controls, on the title's own line */
		badges?: Snippet;
		/** the entity's own prose, between the name and the machine facts */
		lede?: Snippet;
		/** the one-line fact strip under the title (owner, policy, timestamps) */
		meta?: Snippet;
		/** anything below the fact strip, e.g. a scope chip row */
		extra?: Snippet;
		/** right-aligned page action */
		action?: Snippet;
	} = $props();
</script>

<div class="flex flex-wrap items-start justify-between gap-3">
	<div class="flex min-w-0 items-start gap-3">
		<span
			class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"
		>
			<Icon class="size-5" />
		</span>
		<div class="min-w-0 space-y-1">
			<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">{eyebrow}</p>
			<div class="flex flex-wrap items-center gap-2">
				<h1 class="text-2xl font-semibold tracking-tight {mono ? 'font-mono text-xl' : ''}">
					{title}
				</h1>
				{@render badges?.()}
			</div>
			{@render lede?.()}
			{#if meta}<p class="text-xs text-muted-foreground">{@render meta()}</p>{/if}
			{@render extra?.()}
		</div>
	</div>
	{#if action}<div class="shrink-0">{@render action()}</div>{/if}
</div>
