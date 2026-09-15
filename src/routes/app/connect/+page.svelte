<script lang="ts">
	import { resolve } from '$app/paths';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import PageShell from '$lib/components/layout/page-shell.svelte';
	import PageHeader from '$lib/components/layout/page-header.svelte';
	import ConnectSnippets from '$lib/features/tokens/components/connect-snippets.svelte';
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
