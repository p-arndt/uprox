/**
 * Shared presentation helpers for audit / gateway events, so the overview's
 * "Recent activity" feed and the full Audit Log render events consistently.
 */
import Activity from '@lucide/svelte/icons/activity';
import KeyRound from '@lucide/svelte/icons/key-round';
import Plug from '@lucide/svelte/icons/plug';
import ShieldHalf from '@lucide/svelte/icons/shield-half';
import Coins from '@lucide/svelte/icons/coins';
import Boxes from '@lucide/svelte/icons/boxes';
import Users from '@lucide/svelte/icons/users';
import Settings from '@lucide/svelte/icons/settings';
import ScrollText from '@lucide/svelte/icons/scroll-text';

export type EventTone = 'ok' | 'denied' | 'error' | 'neutral';

/** Collapse the many raw status strings into four display tones. */
export function eventTone(status: string): EventTone {
	if (status === 'ok' || status === 'allow') return 'ok';
	if (status === 'deny') return 'denied';
	if (status === 'error') return 'error';
	return 'neutral';
}

/** Tailwind colour for the small status dot, keyed by tone. */
export const toneDot: Record<EventTone, string> = {
	ok: 'bg-emerald-500',
	denied: 'bg-destructive',
	error: 'bg-destructive',
	neutral: 'bg-muted-foreground/50'
};

/** Tailwind text colour for the status word, keyed by tone. */
export const toneText: Record<EventTone, string> = {
	ok: 'text-emerald-600 dark:text-emerald-400',
	denied: 'text-destructive',
	error: 'text-destructive',
	neutral: 'text-muted-foreground'
};

/** Icon for an action, picked from its namespace prefix (`gateway.chat` → gateway). */
export function actionIcon(action: string) {
	const ns = action.split('.')[0];
	switch (ns) {
		case 'gateway':
			return Activity;
		case 'token':
			return KeyRound;
		case 'provider':
			return Plug;
		case 'policy':
			return ShieldHalf;
		case 'pricing':
			return Coins;
		case 'service':
			return Boxes;
		case 'member':
			return Users;
		case 'org':
		case 'settings':
			return Settings;
		default:
			return ScrollText;
	}
}

/** True for gateway traffic (vs. administrative) events. */
export function isGatewayAction(action: string): boolean {
	return action.startsWith('gateway.');
}
