<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { ResolvedPathname } from '$app/types';
	import * as Breadcrumb from '$lib/components/ui/breadcrumb/index.js';
	import * as Command from '$lib/components/ui/command/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Search from '@lucide/svelte/icons/search';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import { toggleMode } from 'mode-watcher';
	import { NAV_ITEMS, NAV_SECTIONS as sections, isNavActive, navItemFor } from '$lib/nav';
	import { viewOnlyNav } from '$lib/nav-access';

	let { data, children } = $props();

	let cmdOpen = $state(false);
	let signOutForm: HTMLFormElement | undefined = $state();

	const viewOnly = (href: string) => viewOnlyNav(href, data.role, data.memberPermissions);

	// The shortcut hint names the modifier the viewer actually has. Decided on
	// mount: the server can't know the platform, and a wrong guess would flash.
	let modKey = $state('');
	onMount(() => {
		const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
		modKey = /mac|iphone|ipad/i.test(nav.userAgentData?.platform ?? nav.platform) ? '⌘' : 'Ctrl';
	});

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

	// The nav entry the current URL sits under. On a detail page this is the
	// *list* it belongs to, which is what the breadcrumb should link back up to.
	const section = $derived(navItemFor(page.url.pathname, NAV_ITEMS));
	const current = $derived(section?.label ?? 'Overview');
	// Detail pages return a `crumb` from their load (the entity's own name). Its
	// presence is what distinguishes "on the list" from "one level below it", so
	// the header stops claiming you are on Services while you read one service.
	const crumb = $derived(page.data.crumb as string | undefined);
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
		{#each sections as section (section.label)}
			<Command.Group heading={section.label}>
				{#each section.items as item (item.href)}
					<Command.Item value={item.label} onSelect={() => go(item.href)}>
						<item.icon class="size-4" />
						<span>{item.label}</span>
						{#if viewOnly(item.href)}
							<span class="ml-auto text-xs text-muted-foreground">View only</span>
						{/if}
					</Command.Item>
				{/each}
			</Command.Group>
		{/each}
	</Command.List>
</Command.Dialog>

<Sidebar.Provider>
	<Sidebar.Root collapsible="icon">
		<Sidebar.Header>
			<div class="flex w-full items-center gap-2 rounded-lg py-1.5">
				<div class="flex aspect-square size-8 items-center justify-center rounded-lg bg-white p-1">
					<img src="/uprox-logo.png" alt="uprox" class="size-full object-contain" />
				</div>
				<div class="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
					<span class="truncate text-sm font-semibold">uprox</span>
					<!-- Build version rather than a static "Workspace" label: it identifies
					     the running instance, which is what someone reporting a bug needs. -->
					<span class="truncate text-xs text-muted-foreground tabular-nums">
						v{data.version}
					</span>
				</div>
			</div>
		</Sidebar.Header>
		<Sidebar.Content>
			{#each sections as section (section.label)}
				<Sidebar.Group>
					<Sidebar.GroupLabel>{section.label}</Sidebar.GroupLabel>
					<Sidebar.GroupContent>
						<Sidebar.Menu>
							{#each section.items as item (item.href)}
								{@const readOnly = viewOnly(item.href)}
								<Sidebar.MenuItem>
									<Sidebar.MenuButton
										isActive={isNavActive(page.url.pathname, item)}
										tooltipContent={readOnly ? `${item.label} (view only)` : item.label}
									>
										{#snippet child({ props })}
											<a href={item.href} {...props}>
												<item.icon />
												<span>{item.label}</span>
											</a>
										{/snippet}
									</Sidebar.MenuButton>
									{#if readOnly}
										<Sidebar.MenuBadge class="font-normal text-muted-foreground">
											View only
										</Sidebar.MenuBadge>
									{/if}
								</Sidebar.MenuItem>
							{/each}
						</Sidebar.Menu>
					</Sidebar.GroupContent>
				</Sidebar.Group>
			{/each}
		</Sidebar.Content>
		<Sidebar.Footer>
			<!-- The account actions live in one menu: loose icon buttons disappear
			     when the sidebar collapses to icons, which stranded sign out. -->
			<form method="post" action="/signout" class="hidden" bind:this={signOutForm}></form>
			<Sidebar.Menu>
				<Sidebar.MenuItem>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
								<Sidebar.MenuButton
									{...props}
									size="lg"
									class="px-2"
									aria-label={`Account menu for ${data.user.name}`}
								>
									<span
										class="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
									>
										{initials}
									</span>
									<span class="grid flex-1 text-left leading-tight">
										<span class="truncate text-sm font-medium">{data.user.name}</span>
										<span class="truncate text-xs text-muted-foreground">{data.user.email}</span>
									</span>
									<ChevronsUpDown class="ml-auto size-4 text-muted-foreground" />
								</Sidebar.MenuButton>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content side="right" align="end" class="w-56">
							<DropdownMenu.Label class="font-normal">
								<span class="block truncate text-sm font-medium">{data.user.name}</span>
								<span class="block truncate text-xs text-muted-foreground">{data.user.email}</span>
							</DropdownMenu.Label>
							<DropdownMenu.Separator />
							<DropdownMenu.Item onSelect={() => toggleMode()}>
								<Sun class="size-4 dark:hidden" />
								<Moon class="hidden size-4 dark:block" />
								Toggle theme
							</DropdownMenu.Item>
							<DropdownMenu.Item onSelect={() => signOutForm?.requestSubmit()}>
								<LogOut class="size-4" />
								Sign out
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</Sidebar.MenuItem>
			</Sidebar.Menu>
		</Sidebar.Footer>
	</Sidebar.Root>

	<!-- min-w-0: the inset is a flex item, and a flex item's default
	     `min-width: auto` refuses to shrink below its content. Without this a
	     table wider than the viewport widened the inset instead of scrolling
	     inside its own container, so the whole page scrolled sideways and the
	     sidebar rode over the content. -->
	<Sidebar.Inset class="min-w-0">
		<header
			class="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur"
		>
			<Sidebar.Trigger class="-ml-1" />
			<Separator orientation="vertical" class="mr-2 h-4" />
			<Breadcrumb.Root>
				<Breadcrumb.List class="text-sm">
					{#if crumb && section}
						<Breadcrumb.Item class="hidden sm:block">
							<Breadcrumb.Link href={section.href}>{section.label}</Breadcrumb.Link>
						</Breadcrumb.Item>
						<Breadcrumb.Separator class="hidden sm:block" />
						<Breadcrumb.Item>
							<Breadcrumb.Page class="max-w-[40vw] truncate">{crumb}</Breadcrumb.Page>
						</Breadcrumb.Item>
					{:else}
						<Breadcrumb.Item>
							<Breadcrumb.Page>{current}</Breadcrumb.Page>
						</Breadcrumb.Item>
					{/if}
				</Breadcrumb.List>
			</Breadcrumb.Root>
			<button
				type="button"
				aria-label="Jump to a page"
				onclick={() => (cmdOpen = true)}
				class="ml-auto flex items-center gap-2 rounded-lg border bg-muted/40 py-1.5 pr-1.5 pl-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
			>
				<Search class="size-4" />
				<span class="hidden sm:inline">Jump to…</span>
				{#if modKey}
					<kbd
						class="hidden rounded border bg-background px-1.5 font-mono text-[10px] leading-5 text-muted-foreground sm:inline"
						>{modKey} K</kbd
					>
				{/if}
			</button>
		</header>
		<main class="flex-1 p-4 sm:p-6">
			{@render children?.()}
		</main>
	</Sidebar.Inset>
</Sidebar.Provider>
