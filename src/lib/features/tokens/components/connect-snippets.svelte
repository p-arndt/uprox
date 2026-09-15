<script lang="ts">
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { connectSnippets } from '$lib/features/tokens/connect-snippets';
	import Copy from '@lucide/svelte/icons/copy';

	let { token }: { token: string } = $props();

	const snippets = $derived(connectSnippets(page.url.origin, token));
	let active = $state('responses');

	async function copy(text: string) {
		await navigator.clipboard.writeText(text);
		toast.success('Snippet copied');
	}
</script>

<Tabs.Root bind:value={active} class="min-w-0">
	<Tabs.List class="h-auto! w-full flex-wrap justify-start rounded-2xl">
		{#each snippets as s (s.id)}
			<Tabs.Trigger value={s.id} class="flex-none text-xs">{s.label}</Tabs.Trigger>
		{/each}
	</Tabs.List>
	{#each snippets as s (s.id)}
		<Tabs.Content value={s.id} class="min-w-0 space-y-2">
			<p class="text-xs text-muted-foreground">{s.when}</p>
			<p class="text-xs">
				<span class="text-muted-foreground">Base URL</span>
				<code class="ml-1 rounded bg-muted px-1.5 py-0.5">{s.baseUrl}</code>
			</p>
			<div class="relative min-w-0">
				<pre class="overflow-x-auto rounded-lg bg-muted p-3 pr-10 text-xs leading-relaxed"><code
						>{s.code}</code
					></pre>
				<Button
					size="icon"
					variant="ghost"
					class="absolute top-1.5 right-1.5 size-7"
					onclick={() => copy(s.code)}
					title="Copy snippet"
				>
					<Copy class="size-3.5" />
				</Button>
			</div>
		</Tabs.Content>
	{/each}
</Tabs.Root>
