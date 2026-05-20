<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import ShieldHalf from '@lucide/svelte/icons/shield-half';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Gauge from '@lucide/svelte/icons/gauge';

	let { data, form } = $props();
	let open = $state(false);

	$effect(() => {
		if (form?.success) {
			open = false;
			invalidateAll();
		}
	});
</script>

<div class="mx-auto max-w-4xl space-y-6">
	<div class="flex items-start justify-between gap-4">
		<div>
			<h2 class="text-xl font-semibold tracking-tight">Policies</h2>
			<p class="text-sm text-muted-foreground">
				Constrain which providers and models a service can reach. Empty lists mean "allow all".
			</p>
		</div>
		<Dialog.Root bind:open>
			<Dialog.Trigger>
				{#snippet child({ props })}
					<Button {...props}><Plus class="size-4" /> New policy</Button>
				{/snippet}
			</Dialog.Trigger>
			<Dialog.Content>
				<Dialog.Header>
					<Dialog.Title>Create policy</Dialog.Title>
					<Dialog.Description>Attach a policy to a service to enforce it.</Dialog.Description>
				</Dialog.Header>
				<form
					method="post"
					action="?/create"
					class="space-y-4"
					use:enhance={() =>
						async ({ update }) =>
							update({ reset: true })}
				>
					<div class="space-y-2">
						<Label for="name">Name</Label>
						<Input id="name" name="name" placeholder="read-only-openai" required />
					</div>
					<div class="space-y-2">
						<Label>Allowed providers</Label>
						<div class="flex flex-wrap gap-4">
							{#each data.providers as p (p.id)}
								<label class="flex items-center gap-2 text-sm">
									<input
										type="checkbox"
										name="allowedProviders"
										value={p.id}
										class="size-4 accent-foreground"
									/>
									{p.label}
								</label>
							{/each}
						</div>
						<p class="text-xs text-muted-foreground">None checked = all providers allowed.</p>
					</div>
					<div class="space-y-2">
						<Label for="allowedModels">Allowed models</Label>
						<Input
							id="allowedModels"
							name="allowedModels"
							placeholder="gpt-4o*, claude-3-5-sonnet"
						/>
						<p class="text-xs text-muted-foreground">
							Comma-separated. Trailing <code>*</code> matches a prefix. Blank = all models.
						</p>
					</div>
					<div class="space-y-2">
						<Label for="rateLimitPerMinute">Rate limit (req/min)</Label>
						<Input
							id="rateLimitPerMinute"
							name="rateLimitPerMinute"
							type="number"
							min="0"
							value="0"
						/>
						<p class="text-xs text-muted-foreground">0 = unlimited.</p>
					</div>
					<Dialog.Footer>
						<Button type="submit">Create policy</Button>
					</Dialog.Footer>
				</form>
			</Dialog.Content>
		</Dialog.Root>
	</div>

	{#if data.policies.length === 0}
		<div class="flex flex-col items-center justify-center rounded-xl border border-dashed py-16">
			<ShieldHalf class="size-8 text-muted-foreground" />
			<p class="mt-3 text-sm font-medium">No policies yet</p>
			<p class="text-sm text-muted-foreground">
				Create a policy to restrict provider and model access.
			</p>
		</div>
	{:else}
		<div class="grid gap-4 sm:grid-cols-2">
			{#each data.policies as p (p.id)}
				<Card.Root>
					<Card.Header class="flex flex-row items-start justify-between space-y-0">
						<div class="flex items-center gap-3">
							<div class="flex size-9 items-center justify-center rounded-lg border bg-muted">
								<ShieldHalf class="size-4" />
							</div>
							<Card.Title class="text-base">{p.name}</Card.Title>
						</div>
						<form
							method="post"
							action="?/delete"
							use:enhance={() =>
								async ({ update }) =>
									update()}
						>
							<input type="hidden" name="id" value={p.id} />
							<Button
								type="submit"
								variant="ghost"
								size="icon"
								class="size-8 text-muted-foreground hover:text-destructive"
								title="Delete policy"
							>
								<Trash2 class="size-4" />
							</Button>
						</form>
					</Card.Header>
					<Card.Content class="space-y-3 text-sm">
						<div>
							<div class="mb-1 text-xs font-medium text-muted-foreground">Providers</div>
							{#if p.allowedProviders.length === 0}
								<Badge variant="outline">all</Badge>
							{:else}
								<div class="flex flex-wrap gap-1">
									{#each p.allowedProviders as pr (pr)}<Badge variant="secondary">{pr}</Badge
										>{/each}
								</div>
							{/if}
						</div>
						<div>
							<div class="mb-1 text-xs font-medium text-muted-foreground">Models</div>
							{#if p.allowedModels.length === 0}
								<Badge variant="outline">all</Badge>
							{:else}
								<div class="flex flex-wrap gap-1">
									{#each p.allowedModels as m (m)}<Badge variant="secondary">{m}</Badge>{/each}
								</div>
							{/if}
						</div>
						<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
							<Gauge class="size-3.5" />
							{p.rateLimitPerMinute === 0 ? 'Unlimited' : `${p.rateLimitPerMinute} req/min`}
						</div>
					</Card.Content>
				</Card.Root>
			{/each}
		</div>
	{/if}
</div>
