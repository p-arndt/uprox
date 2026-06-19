<script lang="ts">
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { RevealedSecret } from '$lib/tokens';
	import Copy from '@lucide/svelte/icons/copy';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	let {
		secret,
		onClose
	}: {
		secret: RevealedSecret | null;
		onClose: () => void;
	} = $props();

	async function copy(text: string, msg = 'Copied to clipboard') {
		await navigator.clipboard.writeText(text);
		toast.success(msg);
	}

	const apiBase = $derived(`${page.url.origin}/v1`);
	function curlFor(token: string) {
		return `curl ${apiBase}/chat/completions \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello"}]}'`;
	}
</script>

<Dialog.Root
	open={secret !== null}
	onOpenChange={(v) => {
		if (!v) onClose();
	}}
>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{secret?.recopyable ? 'Token secret' : 'Token created'}</Dialog.Title>
			<Dialog.Description>
				{#if secret?.recopyable}
					The full secret for <span class="font-medium text-foreground">{secret?.name}</span>. You
					can reveal it again any time from this page.
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
			{#if secret?.recopyable}
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
				title="Copy token"
			>
				<Copy class="size-3.5" />
			</Button>
		</div>

		<div class="min-w-0 space-y-1.5">
			<p class="text-xs font-medium text-muted-foreground">Drop it straight into a request</p>
			<div class="relative min-w-0">
				<pre class="overflow-x-auto rounded-lg bg-muted p-3 pr-10 text-xs leading-relaxed"><code
						>{secret ? curlFor(secret.plaintext) : ''}</code
					></pre>
				<Button
					size="icon"
					variant="ghost"
					class="absolute top-1.5 right-1.5 size-7"
					onclick={() => secret && copy(curlFor(secret.plaintext), 'Command copied')}
					title="Copy command"
				>
					<Copy class="size-3.5" />
				</Button>
			</div>
		</div>
		<Dialog.Footer>
			<Button onclick={onClose}>Done</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
