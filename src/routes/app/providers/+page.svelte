<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/layout/page-header.svelte';
	import ProviderSecretRow from '$lib/features/providers/components/provider-secret-row.svelte';
	import ProviderKeyDialog from '$lib/features/providers/components/provider-key-dialog.svelte';
	import RotateKeyDialog from '$lib/features/providers/components/rotate-key-dialog.svelte';
	import EditMetaDialog from '$lib/features/providers/components/edit-meta-dialog.svelte';
	import {
		credentialNoun,
		savedToast,
		type ProviderKeyDraft,
		type ProviderMetaDraft,
		type ProviderSecret,
		type RotateKeyDraft
	} from '$lib/features/providers/providers';
	import { can } from '$lib/permissions';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Plug from '@lucide/svelte/icons/plug';
	import Plus from '@lucide/svelte/icons/plus';
	import PageShell from '$lib/components/layout/page-shell.svelte';

	let { data, form } = $props();

	type ProviderInfo = (typeof data.providers)[number];

	// add a new key (per provider)
	let adding = $state<ProviderKeyDraft | null>(null);
	// rotate an existing key
	let rotating = $state<RotateKeyDraft | null>(null);
	// edit label / endpoint / priority of an existing secret
	let editingMeta = $state<ProviderMetaDraft | null>(null);

	// secrets grouped by provider, preserving the load order (priority desc)
	const byProvider = $derived(
		data.secrets.reduce((m, s) => {
			(m.get(s.provider) ?? m.set(s.provider, []).get(s.provider)!).push(s);
			return m;
		}, new Map<string, ProviderSecret[]>())
	);
	const configured = $derived(data.providers.filter((p) => byProvider.has(p.id)));
	const unconfigured = $derived(data.providers.filter((p) => !byProvider.has(p.id)));
	const canManage = $derived(can(data.role, 'providers:manage', data.memberPermissions));

	// A dismissed dialog must not reopen with its old error, so its result is
	// marked stale until the next submission replaces `form`.
	let staleForm = $state<typeof form>(null);
	const live = $derived(form && form !== staleForm ? form : null);
	function errorFor(action: string) {
		return live?.action === action && !live.success ? live.message : undefined;
	}
	function connectionFailedFor(action: string) {
		return live?.action === action && 'connectionFailed' in live && live.connectionFailed === true;
	}

	function openAdd(p: ProviderInfo) {
		adding = {
			provider: p.id,
			label: p.label,
			requiresEndpoint: p.requiresEndpoint,
			authScheme: p.authScheme,
			optionalAuth: p.optionalAuth,
			hasKeys: byProvider.has(p.id)
		};
	}
	function closeDialogs() {
		staleForm = form;
		adding = null;
		rotating = null;
		editingMeta = null;
	}

	// each result is handled once, even when the dialogs it reads change later
	let handledForm: typeof form = null;
	$effect(() => {
		const f = form;
		if (!f || f === handledForm) return;
		handledForm = f;
		untrack(() => {
			if (f.success) {
				const message = savedToast(f.action, 'tested' in f ? f.tested : undefined);
				if (message) toast.success(message);
				closeDialogs();
				invalidateAll();
				return;
			}
			if (!f.message) return;
			const dialogOpen =
				(f.action === 'create' && adding) ||
				(f.action === 'rotate' && rotating) ||
				(f.action === 'editMeta' && editingMeta);
			// an open dialog shows its own error inline
			if (!dialogOpen) toast.error(f.message);
		});
	});
</script>

<PageShell width="default">
	<PageHeader title="Providers">
		{#snippet description()}
			Upstream API keys, encrypted at rest with AES-256-GCM. The gateway decrypts them only to proxy
			a request. A provider can hold several keys — e.g. one per Azure OpenAI resource — and a
			service picks which one it uses.
		{/snippet}
	</PageHeader>

	{#if data.secrets.length > 0 && data.activeTokens === 0}
		<Alert.Root role="status">
			<ArrowRight />
			<Alert.Title>Provider connected. Next: create a machine token</Alert.Title>
			<Alert.Description>
				<p>Your apps authenticate to uprox with a machine token, then point their SDK at it.</p>
				<div class="mt-2 flex flex-wrap gap-2">
					<Button href={resolve('/app/tokens')} size="sm">Create a machine token</Button>
					<Button href={resolve('/app/connect')} size="sm" variant="outline">
						Then connect a client
					</Button>
				</div>
			</Alert.Description>
		</Alert.Root>
	{/if}

	<div class="space-y-4">
		{#each configured as p (p.id)}
			{@const secrets = byProvider.get(p.id) ?? []}
			{@const noun = credentialNoun(p.requiresEndpoint)}
			<Card.Root>
				<Card.Header class="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
					<div class="flex items-center gap-3">
						<div class="flex size-9 items-center justify-center rounded-lg border bg-muted">
							<Plug class="size-4" />
						</div>
						<div>
							<Card.Title class="text-base">{p.label}</Card.Title>
							<Card.Description class="text-xs">
								{secrets.length}
								{secrets.length === 1 ? 'key' : 'keys'} configured
							</Card.Description>
						</div>
					</div>
					{#if canManage}
						<Button variant="outline" size="sm" onclick={() => openAdd(p)}>
							<Plus class="size-4" />
							Add<span class="sr-only"> {p.label}</span>
							{noun}
						</Button>
					{/if}
				</Card.Header>
				<Card.Content class="space-y-2">
					{#each secrets as s (s.id)}
						<ProviderSecretRow
							secret={s}
							provider={p}
							showPriority={secrets.length > 1}
							{canManage}
							onRotate={() =>
								(rotating = {
									id: s.id,
									label: s.label || p.label,
									provider: p.id,
									authScheme: p.authScheme,
									optionalAuth: p.optionalAuth
								})}
							onEdit={() =>
								(editingMeta = {
									id: s.id,
									provider: p.id,
									providerLabel: p.label,
									label: s.label ?? '',
									requiresEndpoint: p.requiresEndpoint,
									baseUrl: s.baseUrl ?? '',
									priority: s.priority
								})}
						/>
					{/each}
				</Card.Content>
			</Card.Root>
		{/each}

		{#if unconfigured.length > 0}
			<Card.Root>
				<Card.Header>
					<Card.Title class="text-base">
						{configured.length === 0 ? 'Connect your first provider' : 'Add a provider'}
					</Card.Title>
					<Card.Description>
						{#if configured.length === 0}
							No provider is connected yet, so the gateway has nowhere to send requests.
							{canManage ? 'Pick the one your apps call.' : 'Ask an admin to add a key.'}
						{:else}
							Not configured yet.
						{/if}
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
						{#each unconfigured as p (p.id)}
							{#if canManage}
								<button
									type="button"
									class="flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
									onclick={() => openAdd(p)}
								>
									<Plus class="size-4 shrink-0 text-muted-foreground" />
									<span class="min-w-0 truncate font-medium">
										<span class="sr-only">Add </span>{p.label}<span class="sr-only">
											{credentialNoun(p.requiresEndpoint)}</span
										>
									</span>
								</button>
							{:else}
								<div class="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
									{p.label}
								</div>
							{/if}
						{/each}
					</div>
				</Card.Content>
			</Card.Root>
		{/if}
	</div>
</PageShell>

<ProviderKeyDialog
	{adding}
	message={errorFor('create')}
	connectionFailed={connectionFailedFor('create')}
	onClose={closeDialogs}
/>
<RotateKeyDialog
	{rotating}
	message={errorFor('rotate')}
	connectionFailed={connectionFailedFor('rotate')}
	onClose={closeDialogs}
/>
<EditMetaDialog {editingMeta} message={errorFor('editMeta')} onClose={closeDialogs} />
