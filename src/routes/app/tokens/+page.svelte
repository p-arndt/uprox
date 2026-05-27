<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { NativeSelect } from '$lib/components/ui/native-select/index.js';
	import { relativeTime } from '$lib/format';
	import { can } from '$lib/permissions';
	import { GATEWAY_SCOPES } from '$lib/scopes';
	import Plus from '@lucide/svelte/icons/plus';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Copy from '@lucide/svelte/icons/copy';
	import Ban from '@lucide/svelte/icons/ban';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	let { data, form } = $props();
	let createOpen = $state(false);
	let secret = $state<{ name: string; plaintext: string } | null>(null);

	const allScopes = GATEWAY_SCOPES;
	const canManage = $derived(can(data.role, 'tokens:manage', data.memberPermissions));

	// When the create action returns a fresh secret, reveal it once.
	$effect(() => {
		if (form?.created) {
			secret = form.created;
			createOpen = false;
		}
	});

	async function copy(text: string) {
		await navigator.clipboard.writeText(text);
		toast.success('Token copied to clipboard');
	}

	function status(t: (typeof data.tokens)[number]): {
		label: string;
		variant: 'secondary' | 'destructive' | 'outline';
	} {
		if (t.revokedAt) return { label: 'revoked', variant: 'destructive' };
		if (t.expiresAt && new Date(t.expiresAt).getTime() < Date.now())
			return { label: 'expired', variant: 'outline' };
		return { label: 'active', variant: 'secondary' };
	}
</script>

<div class="mx-auto max-w-5xl space-y-6">
	<div class="flex items-start justify-between gap-4">
		<div>
			<h2 class="text-xl font-semibold tracking-tight">Machine Tokens</h2>
			<p class="text-sm text-muted-foreground">
				Opaque, hashed-at-rest tokens your services use to authenticate to the gateway.
			</p>
		</div>
		{#if canManage}
			<Dialog.Root bind:open={createOpen}>
			<Dialog.Trigger>
				{#snippet child({ props })}
					<Button {...props} disabled={data.services.length === 0}>
						<Plus class="size-4" /> New token
					</Button>
				{/snippet}
			</Dialog.Trigger>
			<Dialog.Content>
				<Dialog.Header>
					<Dialog.Title>Create machine token</Dialog.Title>
					<Dialog.Description>The secret is shown once — store it safely.</Dialog.Description>
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
						<Label for="serviceId">Service</Label>
						<NativeSelect id="serviceId" name="serviceId" class="w-full" required>
							{#each data.services as s (s.id)}
								<option value={s.id}>{s.name}</option>
							{/each}
						</NativeSelect>
					</div>
					<div class="space-y-2">
						<Label for="name">Token name</Label>
						<Input id="name" name="name" placeholder="production" required />
					</div>
					<div class="space-y-2">
						<Label>Scopes</Label>
						<div class="flex flex-wrap gap-4">
							{#each allScopes as scope (scope)}
								<label class="flex items-center gap-2 text-sm">
									<input
										type="checkbox"
										name="scopes"
										value={scope}
										class="size-4 accent-foreground"
									/>
									{scope}
								</label>
							{/each}
						</div>
						<p class="text-xs text-muted-foreground">Leave all unchecked to grant every scope.</p>
					</div>
					<div class="space-y-2">
						<Label for="expiresInDays">Expires</Label>
						<NativeSelect id="expiresInDays" name="expiresInDays" class="w-full">
							<option value="0">Never</option>
							<option value="30">In 30 days</option>
							<option value="90">In 90 days</option>
							<option value="365">In 1 year</option>
						</NativeSelect>
					</div>
					{#if form?.message}
						<p class="text-sm text-destructive">{form.message}</p>
					{/if}
					<Dialog.Footer>
						<Button type="submit">Create token</Button>
					</Dialog.Footer>
				</form>
			</Dialog.Content>
			</Dialog.Root>
		{/if}
	</div>

	{#if data.services.length === 0}
		<div class="flex flex-col items-center justify-center rounded-xl border border-dashed py-16">
			<KeyRound class="size-8 text-muted-foreground" />
			<p class="mt-3 text-sm font-medium">Create a service first</p>
			<p class="text-sm text-muted-foreground">Tokens are issued against a service.</p>
			<Button href="/app/services" variant="outline" size="sm" class="mt-4">Go to services</Button>
		</div>
	{:else if data.tokens.length === 0}
		<div class="flex flex-col items-center justify-center rounded-xl border border-dashed py-16">
			<KeyRound class="size-8 text-muted-foreground" />
			<p class="mt-3 text-sm font-medium">No tokens yet</p>
			<p class="text-sm text-muted-foreground">Issue a token to authenticate a service.</p>
		</div>
	{:else}
		<div class="rounded-xl border">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Name</Table.Head>
						<Table.Head>Token</Table.Head>
						<Table.Head>Service</Table.Head>
						<Table.Head>Scopes</Table.Head>
						<Table.Head>Last used</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head class="w-10"></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.tokens as t (t.id)}
						{@const st = status(t)}
						<Table.Row>
							<Table.Cell class="font-medium">{t.name}</Table.Cell>
							<Table.Cell><code class="text-xs text-muted-foreground">{t.display}</code></Table.Cell
							>
							<Table.Cell class="text-muted-foreground">{t.serviceName}</Table.Cell>
							<Table.Cell>
								{#if t.scopes.length === 0}
									<Badge variant="outline">all</Badge>
								{:else}
									<div class="flex flex-wrap gap-1">
										{#each t.scopes as s (s)}<Badge variant="outline">{s}</Badge>{/each}
									</div>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-muted-foreground">{relativeTime(t.lastUsedAt)}</Table.Cell>
							<Table.Cell><Badge variant={st.variant}>{st.label}</Badge></Table.Cell>
							<Table.Cell>
								{#if !t.revokedAt && canManage}
									<form
										method="post"
										action="?/revoke"
										use:enhance={() =>
											async ({ update }) =>
												update()}
									>
										<input type="hidden" name="id" value={t.id} />
										<Button
											type="submit"
											variant="ghost"
											size="icon"
											class="size-8 text-muted-foreground hover:text-destructive"
											title="Revoke token"
										>
											<Ban class="size-4" />
										</Button>
									</form>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	{/if}
</div>

<!-- one-time secret reveal -->
<Dialog.Root
	open={secret !== null}
	onOpenChange={(v) => {
		if (!v) {
			secret = null;
			invalidateAll();
		}
	}}
>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Token created</Dialog.Title>
			<Dialog.Description>
				Copy <span class="font-medium text-foreground">{secret?.name}</span> now. You won't be able to
				see it again.
			</Dialog.Description>
		</Dialog.Header>
		<div
			class="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
		>
			<TriangleAlert class="mt-0.5 size-4 shrink-0 text-amber-600" />
			<span>This secret is stored only as a hash. There is no way to recover it later.</span>
		</div>
		<div class="flex items-center gap-2">
			<code class="flex-1 overflow-x-auto rounded-lg bg-muted px-3 py-2 text-xs"
				>{secret?.plaintext}</code
			>
			<Button
				size="icon"
				variant="outline"
				onclick={() => secret && copy(secret.plaintext)}
				title="Copy"
			>
				<Copy class="size-4" />
			</Button>
		</div>
		<Dialog.Footer>
			<Button
				onclick={() => {
					secret = null;
					invalidateAll();
				}}>Done</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
