<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { ResolvedPathname } from '$app/types';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Command from '$lib/components/ui/command/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Check from '@lucide/svelte/icons/check';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import Coins from '@lucide/svelte/icons/coins';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Plug from '@lucide/svelte/icons/plug';
	import ScrollText from '@lucide/svelte/icons/scroll-text';
	import Search from '@lucide/svelte/icons/search';
	import Settings from '@lucide/svelte/icons/settings';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import ShieldHalf from '@lucide/svelte/icons/shield-half';
	import Users from '@lucide/svelte/icons/users';

	let { data, children } = $props();

	let cmdOpen = $state(false);

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			cmdOpen = !cmdOpen;
		}
	}

	function go(href: ResolvedPathname) {
		cmdOpen = false;
		goto(href);
	}

	const nav: { href: ResolvedPathname; label: string; icon: typeof Boxes; exact?: boolean }[] = [
		{ href: '/app', label: 'Overview', icon: LayoutDashboard, exact: true },
		{ href: '/app/services', label: 'Services', icon: Boxes },
		{ href: '/app/tokens', label: 'Machine Tokens', icon: KeyRound },
		{ href: '/app/providers', label: 'Providers', icon: Plug },
		{ href: '/app/policies', label: 'Policies', icon: ShieldHalf },
		{ href: '/app/pricing', label: 'Model Prices', icon: Coins },
		{ href: '/app/audit', label: 'Audit Log', icon: ScrollText },
		{ href: '/app/members', label: 'Members', icon: Users },
		{ href: '/app/settings', label: 'Settings', icon: Settings }
	];

	function isActive(href: ResolvedPathname, exact?: boolean) {
		return exact ? page.url.pathname === href : page.url.pathname.startsWith(href);
	}

	const current = $derived(nav.find((n) => isActive(n.href, n.exact))?.label ?? 'Overview');
	const initials = $derived(
		data.user.name
			.split(' ')
			.map((p: string) => p[0])
			.join('')
			.slice(0, 2)
			.toUpperCase() || 'U'
	);
</script>

<svelte:window onkeydown={onKeydown} />

<Toaster richColors closeButton />

<Command.Dialog bind:open={cmdOpen}>
	<Command.Input placeholder="Jump to a page…" />
	<Command.List>
		<Command.Empty>No results found.</Command.Empty>
		<Command.Group heading="Platform">
			{#each nav as item (item.href)}
				<Command.Item value={item.label} onSelect={() => go(item.href)}>
					<item.icon class="size-4" />
					<span>{item.label}</span>
				</Command.Item>
			{/each}
		</Command.Group>
	</Command.List>
</Command.Dialog>

<Sidebar.Provider>
	<Sidebar.Root collapsible="icon">
		<Sidebar.Header>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					class="flex w-full items-center gap-2 rounded-lg py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-sidebar-accent"
				>
					<div
						class="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"
					>
						<ShieldCheck class="size-5" />
					</div>
					<div class="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
						<span class="truncate text-sm font-semibold">uprox</span>
						<span class="truncate text-xs text-muted-foreground"
							>{data.org?.name ?? 'Organization'}</span
						>
					</div>
					<ChevronsUpDown
						class="ml-auto size-4 text-muted-foreground group-data-[collapsible=icon]:hidden"
					/>
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="start" class="min-w-56">
					<DropdownMenu.Label class="text-xs text-muted-foreground"
						>Organizations</DropdownMenu.Label
					>
					{#each data.memberships as m (m.id)}
						<DropdownMenu.Item closeOnSelect={false} class="p-0">
							{#snippet child({ props })}
								<form method="post" action="/active-org" class="w-full">
									<input type="hidden" name="organizationId" value={m.id} />
									<button
										type="submit"
										{...props}
										class="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-sm font-medium outline-hidden focus:bg-accent focus:text-accent-foreground"
									>
										<div class="grid flex-1 leading-tight">
											<span class="truncate">{m.name}</span>
											<span class="truncate text-xs font-normal text-muted-foreground capitalize"
												>{m.role}</span
											>
										</div>
										{#if m.id === data.org?.id}
											<Check class="ml-auto size-4" />
										{/if}
									</button>
								</form>
							{/snippet}
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</Sidebar.Header>
		<Sidebar.Content>
			<Sidebar.Group>
				<Sidebar.GroupLabel>Platform</Sidebar.GroupLabel>
				<Sidebar.GroupContent>
					<Sidebar.Menu>
						{#each nav as item (item.href)}
							<Sidebar.MenuItem>
								<Sidebar.MenuButton
									isActive={isActive(item.href, item.exact)}
									tooltipContent={item.label}
								>
									{#snippet child({ props })}
										<a href={item.href} {...props}>
											<item.icon />
											<span>{item.label}</span>
										</a>
									{/snippet}
								</Sidebar.MenuButton>
							</Sidebar.MenuItem>
						{/each}
					</Sidebar.Menu>
				</Sidebar.GroupContent>
			</Sidebar.Group>
		</Sidebar.Content>
		<Sidebar.Footer>
			<div class="flex items-center gap-2 rounded-lg px-2 py-1.5">
				<div
					class="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-medium"
				>
					{initials}
				</div>
				<div class="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
					<span class="truncate text-sm font-medium">{data.user.name}</span>
					<span class="truncate text-xs text-muted-foreground">{data.user.email}</span>
				</div>
				<form method="post" action="/signout" class="group-data-[collapsible=icon]:hidden">
					<Button type="submit" variant="ghost" size="icon" class="size-8" title="Sign out">
						<LogOut class="size-4" />
					</Button>
				</form>
			</div>
		</Sidebar.Footer>
	</Sidebar.Root>

	<Sidebar.Inset>
		<header
			class="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur"
		>
			<Sidebar.Trigger class="-ml-1" />
			<Separator orientation="vertical" class="mr-2 h-4" />
			<h1 class="text-sm font-medium">{current}</h1>
			<button
				type="button"
				onclick={() => (cmdOpen = true)}
				class="ml-auto flex items-center gap-2 rounded-lg border bg-muted/40 py-1.5 pr-1.5 pl-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
			>
				<Search class="size-4" />
				<span class="hidden sm:inline">Search…</span>
				<kbd
					class="hidden rounded border bg-background px-1.5 font-mono text-[10px] leading-5 text-muted-foreground sm:inline"
					>⌘K</kbd
				>
			</button>
		</header>
		<main class="flex-1 p-4 sm:p-6">
			{@render children?.()}
		</main>
	</Sidebar.Inset>
</Sidebar.Provider>
