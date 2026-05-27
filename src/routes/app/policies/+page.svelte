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
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Gauge from '@lucide/svelte/icons/gauge';
	import Wallet from '@lucide/svelte/icons/wallet';
	import DatabaseZap from '@lucide/svelte/icons/database-zap';

	const fmtBudget = (daily: string | number, monthly: string | number) => {
		const d = Number(daily);
		const m = Number(monthly);
		const parts: string[] = [];
		if (d > 0) parts.push(`$${d}/day`);
		if (m > 0) parts.push(`$${m}/mo`);
		return parts.length ? parts.join(' · ') : 'No budget';
	};

	let { data, form } = $props();
	let open = $state(false);
	let editing = $state<{
		id: string;
		name: string;
		allowedProviders: string[];
		allowedModels: string;
		rateLimitPerMinute: number;
		dailyBudgetUsd: string;
		monthlyBudgetUsd: string;
		cacheTtlSeconds: string;
	} | null>(null);

	$effect(() => {
		if (form?.success) {
			open = false;
			editing = null;
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
					<div class="grid grid-cols-2 gap-4">
						<div class="space-y-2">
							<Label for="dailyBudgetUsd">Daily budget (USD)</Label>
							<Input
								id="dailyBudgetUsd"
								name="dailyBudgetUsd"
								type="number"
								min="0"
								step="0.01"
								value="0"
							/>
						</div>
						<div class="space-y-2">
							<Label for="monthlyBudgetUsd">Monthly budget (USD)</Label>
							<Input
								id="monthlyBudgetUsd"
								name="monthlyBudgetUsd"
								type="number"
								min="0"
								step="0.01"
								value="0"
							/>
						</div>
					</div>
					<p class="-mt-2 text-xs text-muted-foreground">
						Per-service spend ceilings (UTC windows). 0 = unlimited.
					</p>
					<div class="space-y-2">
						<Label for="cacheTtlSeconds">Cache TTL (seconds)</Label>
						<Input
							id="cacheTtlSeconds"
							name="cacheTtlSeconds"
							type="number"
							min="0"
							placeholder="inherit org default"
						/>
						<p class="text-xs text-muted-foreground">
							Overrides the org-wide cache setting. Blank = inherit, 0 = force off, &gt;0 = TTL.
						</p>
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
						<div class="flex items-center gap-1">
							<Button
								variant="ghost"
								size="icon"
								class="size-8 text-muted-foreground"
								title="Edit policy"
								onclick={() =>
									(editing = {
										id: p.id,
										name: p.name,
										allowedProviders: [...p.allowedProviders],
										allowedModels: p.allowedModels.join(', '),
										rateLimitPerMinute: p.rateLimitPerMinute,
										dailyBudgetUsd: String(Number(p.dailyBudgetUsd)),
										monthlyBudgetUsd: String(Number(p.monthlyBudgetUsd)),
										cacheTtlSeconds: p.cacheTtlSeconds == null ? '' : String(p.cacheTtlSeconds)
									})}
							>
								<Pencil class="size-4" />
							</Button>
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
						</div>
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
						<div
							class="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground"
						>
							<span class="flex items-center gap-1.5">
								<Gauge class="size-3.5" />
								{p.rateLimitPerMinute === 0 ? 'Unlimited' : `${p.rateLimitPerMinute} req/min`}
							</span>
							<span class="flex items-center gap-1.5">
								<Wallet class="size-3.5" />
								{fmtBudget(p.dailyBudgetUsd, p.monthlyBudgetUsd)}
							</span>
							<span class="flex items-center gap-1.5">
								<DatabaseZap class="size-3.5" />
								{p.cacheTtlSeconds == null
									? 'Cache: inherit'
									: p.cacheTtlSeconds === 0
										? 'Cache: off'
										: `Cache ${p.cacheTtlSeconds}s`}
							</span>
						</div>
					</Card.Content>
				</Card.Root>
			{/each}
		</div>
	{/if}
</div>

<Dialog.Root
	open={editing !== null}
	onOpenChange={(v) => {
		if (!v) editing = null;
	}}
>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Edit policy</Dialog.Title>
			<Dialog.Description>Attach a policy to a service to enforce it.</Dialog.Description>
		</Dialog.Header>
		{#if editing}
			<form
				method="post"
				action="?/update"
				class="space-y-4"
				use:enhance={() =>
					async ({ update }) => {
						await update();
					}}
			>
				<input type="hidden" name="id" value={editing.id} />
				<div class="space-y-2">
					<Label for="edit-name">Name</Label>
					<Input
						id="edit-name"
						name="name"
						placeholder="read-only-openai"
						value={editing.name}
						required
					/>
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
									checked={editing.allowedProviders.includes(p.id)}
									class="size-4 accent-foreground"
								/>
								{p.label}
							</label>
						{/each}
					</div>
					<p class="text-xs text-muted-foreground">None checked = all providers allowed.</p>
				</div>
				<div class="space-y-2">
					<Label for="edit-allowedModels">Allowed models</Label>
					<Input
						id="edit-allowedModels"
						name="allowedModels"
						placeholder="gpt-4o*, claude-3-5-sonnet"
						value={editing.allowedModels}
					/>
					<p class="text-xs text-muted-foreground">
						Comma-separated. Trailing <code>*</code> matches a prefix. Blank = all models.
					</p>
				</div>
				<div class="space-y-2">
					<Label for="edit-rateLimitPerMinute">Rate limit (req/min)</Label>
					<Input
						id="edit-rateLimitPerMinute"
						name="rateLimitPerMinute"
						type="number"
						min="0"
						value={editing.rateLimitPerMinute}
					/>
					<p class="text-xs text-muted-foreground">0 = unlimited.</p>
				</div>
				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-2">
						<Label for="edit-dailyBudgetUsd">Daily budget (USD)</Label>
						<Input
							id="edit-dailyBudgetUsd"
							name="dailyBudgetUsd"
							type="number"
							min="0"
							step="0.01"
							value={editing.dailyBudgetUsd}
						/>
					</div>
					<div class="space-y-2">
						<Label for="edit-monthlyBudgetUsd">Monthly budget (USD)</Label>
						<Input
							id="edit-monthlyBudgetUsd"
							name="monthlyBudgetUsd"
							type="number"
							min="0"
							step="0.01"
							value={editing.monthlyBudgetUsd}
						/>
					</div>
				</div>
				<p class="-mt-2 text-xs text-muted-foreground">
					Per-service spend ceilings (UTC windows). 0 = unlimited.
				</p>
				<div class="space-y-2">
					<Label for="edit-cacheTtlSeconds">Cache TTL (seconds)</Label>
					<Input
						id="edit-cacheTtlSeconds"
						name="cacheTtlSeconds"
						type="number"
						min="0"
						placeholder="inherit org default"
						value={editing.cacheTtlSeconds}
					/>
					<p class="text-xs text-muted-foreground">
						Overrides the org-wide cache setting. Blank = inherit, 0 = force off, &gt;0 = TTL.
					</p>
				</div>
				<Dialog.Footer>
					<Button type="submit">Save policy</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
