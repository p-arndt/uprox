<script lang="ts">
	import { resolve } from '$app/paths';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import PageShell from '$lib/components/layout/page-shell.svelte';
	import PageHeader from '$lib/components/layout/page-header.svelte';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import ConnectSnippets from '$lib/features/tokens/components/connect-snippets.svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';

	let { data } = $props();

	const missingKey = $derived(data.progress.providerKeys === 0);
	const missingToken = $derived(data.progress.activeTokens === 0);
</script>

<PageShell width="narrow">
	<PageHeader
		title="Connect"
		description="Where to point your client. One machine token works on every surface below."
	>
		{#snippet action()}
			<Button href={resolve('/app/tokens')} variant="outline">Get a token</Button>
		{/snippet}
	</PageHeader>

	{#if missingKey || missingToken}
		<Alert.Root role="status">
			<CircleAlert />
			<Alert.Title>Finish setup before these snippets work</Alert.Title>
			<Alert.Description>
				<ul class="mt-1 space-y-1">
					{#if missingKey}
						<li>
							No provider key yet, so requests have nowhere to go.
							<a href={resolve('/app/providers')} class="font-medium underline underline-offset-4">
								Add one
							</a>
						</li>
					{/if}
					{#if missingToken}
						<li>
							No machine token yet, so clients can't authenticate.
							<a href={resolve('/app/tokens')} class="font-medium underline underline-offset-4">
								Create one
							</a>
						</li>
					{/if}
				</ul>
			</Alert.Description>
		</Alert.Root>
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title>Pick the API your client speaks</Card.Title>
			<Card.Description>
				Replace <code>uprox_live_…</code> with a machine token. The key header differs per SDK (<code
					>Authorization: Bearer</code
				>, <code>api-key</code>, <code>x-goog-api-key</code>) — uprox accepts all of them.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<ConnectSnippets token="uprox_live_…" />
		</Card.Content>
	</Card.Root>
</PageShell>
