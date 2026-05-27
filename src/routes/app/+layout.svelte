<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
	import Boxes from '@lucide/svelte/icons/boxes';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Plug from '@lucide/svelte/icons/plug';
	import ScrollText from '@lucide/svelte/icons/scroll-text';
	import ShieldHalf from '@lucide/svelte/icons/shield-half';
	import Coins from '@lucide/svelte/icons/coins';
	import Settings from '@lucide/svelte/icons/settings';
	import LogOut from '@lucide/svelte/icons/log-out';

	let { data, children } = $props();

	const nav: { href: Pathname; label: string; icon: typeof Boxes; exact?: boolean }[] = [
		{ href: '/app', label: 'Overview', icon: LayoutDashboard, exact: true },
		{ href: '/app/services', label: 'Services', icon: Boxes },
		{ href: '/app/tokens', label: 'Machine Tokens', icon: KeyRound },
		{ href: '/app/providers', label: 'Providers', icon: Plug },
		{ href: '/app/policies', label: 'Policies', icon: ShieldHalf },
		{ href: '/app/pricing', label: 'Model Prices', icon: Coins },
		{ href: '/app/audit', label: 'Audit Log', icon: ScrollText },
		{ href: '/app/settings', label: 'Settings', icon: Settings }
	];

	function isActive(href: string, exact?: boolean) {
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

<Toaster richColors closeButton />

<Sidebar.Provider>
	<Sidebar.Root collapsible="icon">
		<Sidebar.Header>
			<div class="flex items-center gap-2 py-1.5">
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
			</div>
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
										<a href={resolve(item.href)} {...props}>
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
		</header>
		<main class="flex-1 p-4 sm:p-6">
			{@render children?.()}
		</main>
	</Sidebar.Inset>
</Sidebar.Provider>
