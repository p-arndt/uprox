<script lang="ts">
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import ConnectSnippets from '$lib/features/tokens/components/connect-snippets.svelte';
	import type { RevealedSecret } from '$lib/features/tokens/tokens';
	import Copy from '@lucide/svelte/icons/copy';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	let {
		secret,
		onClose
	}: {
		secret: RevealedSecret | null;
		onClose: () => void;
	} = $props();

	// A hash-only secret is gone once this closes, so a stray Escape or click
	// outside must not dismiss it; only the explicit button does.
	const dismissable = $derived(secret?.recopyable === true);
	const dismissBehavior: 'close' | 'ignore' = $derived(dismissable ? 'close' : 'ignore');

	async function copy(text: string, msg = 'Copied to clipboard') {
		await navigator.clipboard.writeText(text);
		toast.success(msg);
	}
</script>

<Dialog.Root
	open={secret !== null}
	onOpenChange={(v) => {
		if (!v && dismissable) onClose();
	}}
>
	<Dialog.Content
		class="sm:max-w-2xl"
		showCloseButton={dismissable}
		escapeKeydownBehavior={dismissBehavior}
		interactOutsideBehavior={dismissBehavior}
	>
		<Dialog.Header>
			<Dialog.Title>{dismissable ? 'Token secret' : 'Token created'}</Dialog.Title>
			<Dialog.Description>
				{#if dismissable}
					The full secret for <span class="font-medium text-foreground">{secret?.name}</span>. You
					can reveal it again any time from the token's page.
				{:else}
					Copy <span class="font-medium text-foreground">{secret?.name}</span> now. You won't be able
					to see it again.
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		<div
			class="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
		>
			<TriangleAlert class="mt-0.5 size-4 shrink-0 text-amber-600" />
			{#if dismissable}
				<span>This token is stored encrypted so it can be re-copied. Keep it secret.</span>
			{:else}
				<span>This secret is stored only as a hash. There is no way to recover it later.</span>
			{/if}
		</div>
		<div class="relative min-w-0">
			<code class="block overflow-x-auto rounded-lg bg-muted py-2.5 pr-11 pl-3 text-xs"
				>{secret?.plaintext}</code
			>
			<Button
				size="icon"
				variant="ghost"
				class="absolute top-1/2 right-1.5 size-7 -translate-y-1/2"
				onclick={() => secret && copy(secret.plaintext, 'Token copied')}
				aria-label="Copy token"
				title="Copy token"
			>
				<Copy class="size-3.5" />
			</Button>
		</div>

		<div class="min-w-0 space-y-1.5">
			<p class="text-xs font-medium text-muted-foreground">Where to send it</p>
			{#if secret}<ConnectSnippets token={secret.plaintext} />{/if}
		</div>
		<Dialog.Footer>
			<Button onclick={onClose}>{dismissable ? 'Done' : "I've copied it"}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
