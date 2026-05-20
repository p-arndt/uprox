<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import DatabaseZap from '@lucide/svelte/icons/database-zap';

	let { data, form } = $props();

	$effect(() => {
		if (form?.success) {
			toast.success('Settings saved');
			invalidateAll();
		}
	});
</script>

<div class="mx-auto max-w-2xl space-y-6">
	<div>
		<h2 class="text-xl font-semibold tracking-tight">Settings</h2>
		<p class="text-sm text-muted-foreground">Org-wide gateway defaults.</p>
	</div>

	<Card.Root>
		<Card.Header>
			<div class="flex items-center gap-3">
				<div class="flex size-9 items-center justify-center rounded-lg border bg-muted">
					<DatabaseZap class="size-4" />
				</div>
				<div>
					<Card.Title class="text-base">Response cache</Card.Title>
					<Card.Description>
						Exact-match cache for chat & embeddings, applied to every service.
					</Card.Description>
				</div>
			</div>
		</Card.Header>
		<Card.Content>
			<form
				method="post"
				action="?/updateCache"
				class="space-y-4"
				use:enhance={() =>
					async ({ update }) =>
						update({ reset: false })}
			>
				<div class="space-y-2">
					<Label for="cacheTtlSeconds">Default cache TTL (seconds)</Label>
					<Input
						id="cacheTtlSeconds"
						name="cacheTtlSeconds"
						type="number"
						min="0"
						value={data.settings.cacheTtlSeconds}
						class="max-w-xs"
					/>
					<p class="text-xs text-muted-foreground">
						0 disables caching org-wide. Identical requests within the TTL replay the stored
						response at zero cost (streaming included). A policy can override this per service.
					</p>
				</div>
				<Button type="submit">Save</Button>
			</form>
		</Card.Content>
	</Card.Root>
</div>
