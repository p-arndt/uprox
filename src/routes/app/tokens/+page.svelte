<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import TokenForm, { type TokenFormValues } from '$lib/components/token-form.svelte';
	import { relativeTime } from '$lib/format';
	import { can } from '$lib/permissions';
	import Plus from '@lucide/svelte/icons/plus';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Copy from '@lucide/svelte/icons/copy';
	import Ban from '@lucide/svelte/icons/ban';
	import Pencil from '@lucide/svelte/icons/pencil';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	let { data, form } = $props();
	let createOpen = $state(false);
	let serviceId = $state('');
	let expiresInDays = $state('0');
	const expiryOptions = [
		{ value: '0', label: 'Never' },
		{ value: '30', label: 'In 30 days' },
		{ value: '90', label: 'In 90 days' },
		{ value: '365', label: 'In 1 year' }
	];
	let secret = $state<{ name: string; plaintext: string } | null>(null);
	let editing = $state<TokenFormValues | null>(null);

	const createValues: TokenFormValues = {
		name: '',
		scopes: [],
		allowedModels: '',
		policyId: ''
	};

	const canManage = $derived(can(data.role, 'tokens:manage', data.memberPermissions));

	// When the create action returns a fresh secret, reveal it once.
	$effect(() => {
		if (form?.created) {
			secret = form.created;
			createOpen = false;
		}
	});

	// Close the edit dialog once an update succeeds.
	$effect(() => {
		if (form?.success) {
			editing = null;
			invalidateAll();
		}
	});

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

	function status(t: (typeof data.tokens)[number]): {
		label: string;
		dot: string;
		pulse?: boolean;
	} {
		if (t.revokedAt) return { label: 'revoked', dot: 'bg-red-500' };
		if (t.expiresAt && new Date(t.expiresAt).getTime() < Date.now())
			return { label: 'expired', dot: 'bg-amber-500' };
		return { label: 'active', dot: 'bg-emerald-500', pulse: true };
	}

	const stats = $derived.by(() => {
		const now = Date.now();
		let active = 0;
		let inactive = 0;
		let lastUsed: number | null = null;
		for (const t of data.tokens) {
			if (t.revokedAt || (t.expiresAt && new Date(t.expiresAt).getTime() < now)) inactive++;
			else active++;
			if (t.lastUsedAt) {
				const ts = new Date(t.lastUsedAt).getTime();
				if (lastUsed === null || ts > lastUsed) lastUsed = ts;
			}
		}
		return { total: data.tokens.length, active, inactive, lastUsed };
	});

	// Revoked tokens are kept for the audit trail but hidden by default —
	// the row is functionally dead the moment it's revoked.
	let showRevoked = $state(false);
	const revokedCount = $derived(data.tokens.filter((t) => t.revokedAt).length);
	const visibleTokens = $derived(
		showRevoked ? data.tokens : data.tokens.filter((t) => !t.revokedAt)
	);

	function startEdit(t: (typeof data.tokens)[number]) {
		editing = {
			id: t.id,
			name: t.name,
			scopes: [...t.scopes],
			allowedModels: t.allowedModels.join(', '),
			policyId: t.policyId ?? ''
		};
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
					<TokenForm
						action="?/create"
						submitLabel="Create token"
						idPrefix="create"
						values={createValues}
						policies={data.policies}
						resetOnSuccess
					>
						{#snippet topFields()}
							<div class="space-y-2">
								<Label for="serviceId">Service</Label>
								<Select.Root type="single" name="serviceId" required bind:value={serviceId}>
									<Select.Trigger id="serviceId" class="w-full">
										{data.services.find((s) => s.id === serviceId)?.name ?? 'Select a service'}
									</Select.Trigger>
									<Select.Content>
										{#each data.services as s (s.id)}
											<Select.Item value={s.id} label={s.name}>{s.name}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
						{/snippet}
						{#snippet bottomFields()}
							<div class="space-y-2">
								<Label for="expiresInDays">Expires</Label>
								<Select.Root type="single" name="expiresInDays" bind:value={expiresInDays}>
									<Select.Trigger id="expiresInDays" class="w-full">
										{expiryOptions.find((o) => o.value === expiresInDays)?.label}
									</Select.Trigger>
									<Select.Content>
										{#each expiryOptions as o (o.value)}
											<Select.Item value={o.value} label={o.label}>{o.label}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
							{#if form?.message}
								<p class="text-sm text-destructive">{form.message}</p>
							{/if}
						{/snippet}
					</TokenForm>
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
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
			<div class="rounded-xl border bg-card p-4">
				<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Total</p>
				<p class="mt-1 text-2xl font-semibold tabular-nums">{stats.total}</p>
			</div>
			<div class="rounded-xl border bg-card p-4">
				<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Active</p>
				<p class="mt-1 flex items-center gap-2 text-2xl font-semibold tabular-nums">
					<span class="dot-pulse size-2 rounded-full bg-emerald-500"></span>
					{stats.active}
				</p>
			</div>
			<div class="rounded-xl border bg-card p-4">
				<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Inactive</p>
				<p class="mt-1 text-2xl font-semibold text-muted-foreground tabular-nums">
					{stats.inactive}
				</p>
			</div>
			<div class="rounded-xl border bg-card p-4">
				<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Last used</p>
				<p class="mt-1.5 truncate text-lg font-semibold">
					{relativeTime(stats.lastUsed ? new Date(stats.lastUsed) : null)}
				</p>
			</div>
		</div>

		{#if revokedCount > 0}
			<div class="flex items-center justify-end gap-2">
				<Switch id="showRevoked" bind:checked={showRevoked} />
				<Label for="showRevoked" class="text-sm text-muted-foreground">
					Show revoked ({revokedCount})
				</Label>
			</div>
		{/if}

		<div class="rounded-xl border">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Name</Table.Head>
						<Table.Head>Token</Table.Head>
						<Table.Head>Service</Table.Head>
						<Table.Head>Scopes</Table.Head>
						<Table.Head>Policy / Models</Table.Head>
						<Table.Head>Last used</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head class="w-10"></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#if visibleTokens.length === 0}
						<Table.Row class="hover:bg-transparent">
							<Table.Cell colspan={8} class="py-8 text-center text-sm text-muted-foreground">
								All tokens are revoked. Toggle “Show revoked” to view them.
							</Table.Cell>
						</Table.Row>
					{/if}
					{#each visibleTokens as t (t.id)}
						{@const st = status(t)}
						<Table.Row class="group transition-colors hover:bg-accent/40">
							<Table.Cell class="font-medium">{t.name}</Table.Cell>
							<Table.Cell>
								<span
									title="Token prefix (the full token is shown only once at creation)"
									class="inline-flex items-center rounded-md bg-muted/60 px-2 py-1 font-mono text-xs text-muted-foreground"
								>
									{t.display}
								</span>
							</Table.Cell>
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
							<Table.Cell>
								{#if t.policyId}
									<Badge variant="secondary">{t.policyName}</Badge>
								{:else}
									<span class="text-xs text-muted-foreground">service policy</span>
								{/if}
								{#if t.allowedModels.length > 0}
									<div class="mt-1 flex flex-wrap gap-1">
										{#each t.allowedModels as m (m)}
											<Badge variant="outline" class="font-mono text-[10px]">{m}</Badge>
										{/each}
									</div>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-muted-foreground">{relativeTime(t.lastUsedAt)}</Table.Cell>
							<Table.Cell>
								<span class="inline-flex items-center gap-1.5 text-sm capitalize">
									<span class="size-1.5 rounded-full {st.dot} {st.pulse ? 'dot-pulse' : ''}"></span>
									{st.label}
								</span>
							</Table.Cell>
							<Table.Cell>
								{#if !t.revokedAt && canManage}
									<div class="flex items-center justify-end gap-0.5">
										<Button
											variant="ghost"
											size="icon"
											class="size-8 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
											title="Edit token"
											onclick={() => startEdit(t)}
										>
											<Pencil class="size-4" />
										</Button>
										<AlertDialog.Root>
											<AlertDialog.Trigger>
												{#snippet child({ props })}
													<Button
														{...props}
														variant="ghost"
														size="icon"
														class="size-8 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 hover:text-destructive"
														title="Revoke token"
													>
														<Ban class="size-4" />
													</Button>
												{/snippet}
											</AlertDialog.Trigger>
											<AlertDialog.Content>
												<AlertDialog.Header>
													<AlertDialog.Title>Revoke “{t.name}”?</AlertDialog.Title>
													<AlertDialog.Description>
														Any service still using this token will immediately fail to
														authenticate. This can't be undone.
													</AlertDialog.Description>
												</AlertDialog.Header>
												<AlertDialog.Footer>
													<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
													<form
														method="post"
														action="?/revoke"
														use:enhance={() =>
															async ({ update }) =>
																update()}
													>
														<input type="hidden" name="id" value={t.id} />
														<AlertDialog.Action type="submit" variant="destructive">
															Revoke token
														</AlertDialog.Action>
													</form>
												</AlertDialog.Footer>
											</AlertDialog.Content>
										</AlertDialog.Root>
									</div>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	{/if}
</div>

<!-- edit token: change its policy, model allowlist, scopes, and name in place -->
<Dialog.Root
	open={editing !== null}
	onOpenChange={(v) => {
		if (!v) editing = null;
	}}
>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Edit token</Dialog.Title>
			<Dialog.Description>
				Adjust this token's access. The secret itself never changes.
			</Dialog.Description>
		</Dialog.Header>
		{#if editing}
			{#key editing.id}
				<TokenForm
					action="?/update"
					submitLabel="Save token"
					idPrefix="edit"
					values={editing}
					policies={data.policies}
				>
					{#snippet bottomFields()}
						{#if form?.message}
							<p class="text-sm text-destructive">{form.message}</p>
						{/if}
					{/snippet}
				</TokenForm>
			{/key}
		{/if}
	</Dialog.Content>
</Dialog.Root>

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
	<Dialog.Content class="sm:max-w-lg">
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
			<Button
				onclick={() => {
					secret = null;
					invalidateAll();
				}}>Done</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
