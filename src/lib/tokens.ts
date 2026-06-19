/** Client-side machine-token types and helpers for the Tokens page. */

/** A machine token row as listed on the tokens page. */
export interface Token {
	id: string;
	name: string;
	display: string;
	scopes: string[];
	allowedModels: string[];
	serviceId: string;
	serviceName: string;
	policyId: string | null;
	policyName: string | null;
	recopyable: boolean;
	lastUsedAt: Date | string | null;
	expiresAt: Date | string | null;
	revokedAt: Date | string | null;
	createdAt: Date | string;
}

/** The one-time (or re-copyable) plaintext secret surfaced after create/reveal. */
export interface RevealedSecret {
	name: string;
	plaintext: string;
	/** true when the secret is stored encrypted and can be revealed again */
	recopyable?: boolean;
}

export interface TokenStatus {
	label: string;
	/** tailwind bg class for the status dot */
	dot: string;
	/** animate the dot when the token is live */
	pulse?: boolean;
}

/** A token's lifecycle state, derived from its revoked/expiry timestamps. */
export function tokenStatus(t: Pick<Token, 'revokedAt' | 'expiresAt'>): TokenStatus {
	if (t.revokedAt) return { label: 'revoked', dot: 'bg-red-500' };
	if (t.expiresAt && new Date(t.expiresAt).getTime() < Date.now())
		return { label: 'expired', dot: 'bg-amber-500' };
	return { label: 'active', dot: 'bg-emerald-500', pulse: true };
}

export interface TokenStats {
	total: number;
	active: number;
	inactive: number;
	/** epoch ms of the most recent use across all tokens, or null */
	lastUsed: number | null;
}

/** Headline counts for the stat cards: live vs. dead tokens, and when one was last used. */
export function tokenStats(tokens: Token[]): TokenStats {
	const now = Date.now();
	let active = 0;
	let inactive = 0;
	let lastUsed: number | null = null;
	for (const t of tokens) {
		if (t.revokedAt || (t.expiresAt && new Date(t.expiresAt).getTime() < now)) inactive++;
		else active++;
		if (t.lastUsedAt) {
			const ts = new Date(t.lastUsedAt).getTime();
			if (lastUsed === null || ts > lastUsed) lastUsed = ts;
		}
	}
	return { total: tokens.length, active, inactive, lastUsed };
}
