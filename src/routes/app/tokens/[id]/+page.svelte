<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import UsageRangePicker from '$lib/components/usage-range-picker.svelte';
	import UsageWorkbench from '$lib/components/usage-workbench.svelte';
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import type { ResolvedPathname } from '$app/types';
	import { buildUsageHref, type UsageUrlOverrides } from '$lib/usage-url';
	import type { UsageDimension, UsageFilter } from '$lib/usage-group';
	import type { DimensionUsageRow } from '$lib/server/data';
	import { toast } from 'svelte-sonner';
	import { relativeTime } from '$lib/format';
	import { can } from '$lib/permissions';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Eye from '@lucide/svelte/icons/eye';
	import Copy from '@lucide/svelte/icons/copy';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	let { data, form } = $props();

	const canManage = $derived(can(data.role, 'tokens:manage', data.memberPermissions));

	// Holds the revealed secret for the copy dialog (re-copyable tokens only).
	let secret = $state<{ name: string; plaintext: string } | null>(null);
	$effect(() => {
		if (form?.revealed) secret = form.revealed;
	});
	async function copy(text: string, msg = 'Copied to clipboard') {
		await navigator.clipboard.writeText(text);
		toast.success(msg);
	}

	const rangeLabel = $derived(
		data.range === 'custom'
			? `${data.customFrom} – ${data.customTo}`
			: (data.ranges.find((r) => r.key === data.range)?.label ?? data.range)
	);

	// Preserve the params we aren't explicitly changing. Page-owned so the
	// resolve()/navigation lint rule is satisfied at the source.
	function hrefWith(overrides: UsageUrlOverrides): ResolvedPathname {
		return buildUsageHref(
			resolve('/app/tokens/[id]', { id: data.token.id }),
			{
				range: data.range,
				bucket: data.bucket,
				customFrom: data.customFrom,
				customTo: data.customTo,
				groupBy: data.groupBy,
				filters: data.filters
			},
			overrides
		) as ResolvedPathname;
	}

	function applyCustom(from: string, to: string) {
		goto(hrefWith({ range: 'custom', from, to }), { noScroll: true });
	}

	// Re-runs the page load (re-querying usage) without a full reload, so operators
	// can pull fresh figures in place. invalidateAll resolves once the new data lands.
	let refreshing = $state(false);
	async function refresh() {
		if (refreshing) return;
		refreshing = true;
		try {
			await invalidateAll();
		} finally {
			refreshing = false;
		}
	}

	// Active / expired / revoked, mirroring the tokens list badge.
	const tokenStatus = $derived.by(() => {
		const t = data.token;
		if (t.revokedAt) return { label: 'revoked', dot: 'bg-red-500' };
		if (t.expiresAt && new Date(t.expiresAt).getTime() < Date.now())
			return { label: 'expired', dot: 'bg-amber-500' };
		return { label: 'active', dot: 'bg-emerald-500', pulse: true };
	});

	// Group-by and filters are URL state here too, so a drilled-in token view is
	// just as shareable as the org-wide one.
	function setGroupBy(dim: UsageDimension) {
		goto(hrefWith({ groupBy: dim }), { noScroll: true, keepFocus: true });
	}
	function setFilters(filters: UsageFilter[]) {
		goto(hrefWith({ filters }), { noScroll: true, keepFocus: true });
	}
</script>

{#snippet rowLabel(row: DimensionUsageRow, dim: UsageDimension)}
	{#if dim === 'model'}
		<span class="truncate font-mono text-[13px] font-medium" title={row.label}>{row.label}</span>
	{:else}
		<span class="truncate font-medium" title={row.label}>{row.label}</span>
	{/if}
{/snippet}

{#snippet leading()}
	<UsageRangePicker
		ranges={data.ranges}
		range={data.range}
		{hrefWith}
		customFrom={data.customFrom}
		customTo={data.customTo}
		onApplyCustom={applyCustom}
	/>
{/snippet}

{#snippet trailing()}
	<Button
		variant="ghost"
		size="icon"
		class="size-8"
		onclick={refresh}
		disabled={refreshing}
		aria-label="Refresh usage"
	>
		<RefreshCw class="size-4 {refreshing ? 'animate-spin' : ''}" />
	</Button>
{/snippet}

<div class="mx-auto max-w-7xl space-y-6">
	<a
		href={resolve('/app/tokens')}
		class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
	>
		<ChevronLeft class="size-4" /> Tokens
	</a>

	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="flex items-start gap-3">
			<span
				class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"
			>
				<KeyRound class="size-5" />
			</span>
			<div class="space-y-1">
				<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
					Machine token
				</p>
				<div class="flex flex-wrap items-center gap-2">
					<h2 class="text-lg font-semibold">{data.token.name}</h2>
					<span class="inline-flex items-center gap-1.5 text-sm text-muted-foreground capitalize">
						<span
							class="size-1.5 rounded-full {tokenStatus.dot} {tokenStatus.pulse ? 'dot-pulse' : ''}"
						></span>
						{tokenStatus.label}
					</span>
					<span
						title="Token prefix (the full token is shown only once at creation)"
						class="inline-flex items-center rounded-md bg-muted/60 px-2 py-0.5 font-mono text-xs text-muted-foreground"
					>
						{data.token.display}
					</span>
					{#if data.token.recopyable && canManage}
						<form
							method="post"
							action="?/reveal"
							use:enhance={() =>
								async ({ update }) =>
									update({ reset: false })}
						>
							<Button type="submit" variant="outline" size="sm" class="h-7 gap-1.5 text-xs">
								<Eye class="size-3.5" /> Reveal
							</Button>
						</form>
					{/if}
				</div>
				<p class="text-xs text-muted-foreground">
					Service:
					<a
						href={resolve('/app/services/[id]', { id: data.token.serviceId })}
						class="font-medium hover:underline"
					>
						{data.token.serviceName}
					</a>
					· Policy: {data.token.policyId
						? (data.token.policyName ?? 'No policy')
						: 'inherits service policy'} · created {relativeTime(data.token.createdAt)} · last used {relativeTime(
						data.token.lastUsedAt
					)}
				</p>
				{#if data.token.scopes.length > 0}
					<div class="flex flex-wrap gap-1 pt-0.5">
						{#each data.token.scopes as s (s)}<Badge variant="outline">{s}</Badge>{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>

	<UsageWorkbench
		analysis={data}
		{rangeLabel}
		bucketHref={(b) => hrefWith({ bucket: b })}
		onGroupBy={setGroupBy}
		onFilters={setFilters}
		{rowLabel}
		{leading}
		{trailing}
	/>
</div>

<!-- re-copy reveal: shows the stored secret again for a re-copyable token -->
<Dialog.Root
	open={secret !== null}
	onOpenChange={(v) => {
		if (!v) secret = null;
	}}
>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Token secret</Dialog.Title>
			<Dialog.Description>
				The full secret for <span class="font-medium text-foreground">{secret?.name}</span>. You can
				reveal it again any time from this page.
			</Dialog.Description>
		</Dialog.Header>
		<div
			class="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
		>
			<TriangleAlert class="mt-0.5 size-4 shrink-0 text-amber-600" />
			<span>This token is stored encrypted so it can be re-copied. Keep it secret.</span>
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
		<Dialog.Footer>
			<Button onclick={() => (secret = null)}>Done</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
