/**
 * The app shell's navigation: sidebar sections, the ⌘K command list and the
 * breadcrumb all read from this one config.
 */

import type { ResolvedPathname } from '$app/types';
import type { Component } from 'svelte';
import Boxes from '@lucide/svelte/icons/boxes';
import ChartColumn from '@lucide/svelte/icons/chart-column';
import Coins from '@lucide/svelte/icons/coins';
import KeyRound from '@lucide/svelte/icons/key-round';
import Plug from '@lucide/svelte/icons/plug';
import ScrollText from '@lucide/svelte/icons/scroll-text';
import Settings from '@lucide/svelte/icons/settings';
import ShieldHalf from '@lucide/svelte/icons/shield-half';
import Users from '@lucide/svelte/icons/users';
import Waypoints from '@lucide/svelte/icons/waypoints';

export interface NavItem {
	href: ResolvedPathname;
	label: string;
	icon: Component;
	/** match the path exactly instead of as a prefix */
	exact?: boolean;
}

export interface NavSection {
	label: string;
	items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
	{
		label: 'Gateway',
		items: [
			{ href: '/app/services', label: 'Services', icon: Boxes },
			{ href: '/app/tokens', label: 'Machine Tokens', icon: KeyRound },
			{ href: '/app/providers', label: 'Providers', icon: Plug }
		]
	},
	{
		label: 'Monitor',
		items: [
			{ href: '/app/usage', label: 'Cost analysis', icon: ChartColumn },
			{ href: '/app/traces', label: 'Traces', icon: Waypoints },
			{ href: '/app/audit', label: 'Audit Log', icon: ScrollText }
		]
	},
	{
		label: 'Configure',
		items: [
			{ href: '/app/policies', label: 'Presets', icon: ShieldHalf },
			{ href: '/app/pricing', label: 'Model Prices', icon: Coins }
		]
	},
	{
		label: 'Workspace',
		items: [
			{ href: '/app/members', label: 'Members', icon: Users },
			{ href: '/app/settings', label: 'Settings', icon: Settings }
		]
	}
];

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

/** Whether a nav item is the current page (or, for prefix items, one below it). */
export function isNavActive(pathname: string, item: Pick<NavItem, 'href' | 'exact'>): boolean {
	return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

/**
 * The nav entry a path sits under. On a detail page this is the *list* it
 * belongs to, which is what the breadcrumb links back up to.
 */
export function navItemFor<T extends Pick<NavItem, 'href' | 'exact'>>(
	pathname: string,
	items: T[]
): T | undefined {
	return items.find((item) => isNavActive(pathname, item));
}
