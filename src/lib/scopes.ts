/**
 * Canonical list of gateway scopes (a.k.a. provider capabilities). This is the
 * single source of truth shared by the policy engine, the provider registry,
 * and the dashboard token UI — so a token can never be scoped for, nor a
 * provider claim, something that isn't a real gateway endpoint.
 *
 * Kept outside `$lib/server` so the client (token creation form) can import it.
 */
export const GATEWAY_SCOPES = [
	'chat',
	'responses',
	'embeddings',
	'models',
	'images',
	'files',
	'transcriptions',
	'realtime'
] as const;

export type GatewayScope = (typeof GATEWAY_SCOPES)[number];

export interface ScopeInfo {
	label: string;
	/** which gateway endpoints the scope unlocks, in one line */
	description: string;
}

export const SCOPE_INFO: Record<GatewayScope, ScopeInfo> = {
	chat: {
		label: 'Chat completions',
		description: 'POST /chat/completions, incl. Gemini generateContent'
	},
	responses: { label: 'Responses', description: 'POST /responses' },
	embeddings: {
		label: 'Embeddings',
		description: 'POST /embeddings, incl. Gemini embedContent'
	},
	models: { label: 'Model list', description: 'GET /models — lists the models the token may use' },
	images: { label: 'Images', description: 'POST /images/generations and /images/edits' },
	files: { label: 'Files', description: 'Upload, list, read and delete via /files' },
	transcriptions: { label: 'Transcriptions', description: 'POST /audio/transcriptions' },
	realtime: {
		label: 'Realtime',
		description:
			'POST /realtime/client_secrets, /realtime/sessions and /realtime/transcription_sessions'
	}
};

const isGatewayScope = (s: string): s is GatewayScope =>
	(GATEWAY_SCOPES as readonly string[]).includes(s);

/** Human label for a scope id; unknown ids (e.g. legacy rows) fall back to the raw id. */
export const scopeLabel = (scope: string): string =>
	isGatewayScope(scope) ? SCOPE_INFO[scope].label : scope;

export type ScopeBundleId = 'all' | 'chat' | 'embeddings' | 'custom';

export interface ScopeBundle {
	id: Exclude<ScopeBundleId, 'custom'>;
	label: string;
	scopes: readonly GatewayScope[];
}

/**
 * Named quick picks. `all` is the empty list because the policy engine treats
 * an unscoped token as allowed everywhere, including scopes added later. The
 * narrower bundles include `models` so SDKs can still list what they may call.
 */
export const SCOPE_BUNDLES: readonly ScopeBundle[] = [
	{ id: 'all', label: 'All endpoints', scopes: [] },
	{ id: 'chat', label: 'Chat & Responses', scopes: ['chat', 'responses', 'models'] },
	{ id: 'embeddings', label: 'Embeddings', scopes: ['embeddings', 'models'] }
];

export const CUSTOM_BUNDLE_LABEL = 'Custom';

/** Known scopes only, deduplicated, in canonical order — so equal sets compare equal. */
export function normalizeScopes(scopes: readonly string[]): GatewayScope[] {
	return GATEWAY_SCOPES.filter((s) => scopes.includes(s));
}

/** The bundle a scope list equals (order-insensitive), else 'custom'. */
export function bundleForScopes(scopes: readonly string[]): ScopeBundleId {
	// unknown ids would otherwise vanish in normalization and fake a bundle match
	if (scopes.some((s) => !isGatewayScope(s))) return 'custom';
	const key = normalizeScopes(scopes).join(',');
	return SCOPE_BUNDLES.find((b) => normalizeScopes(b.scopes).join(',') === key)?.id ?? 'custom';
}

export function scopesForBundle(id: Exclude<ScopeBundleId, 'custom'>): GatewayScope[] {
	return [...(SCOPE_BUNDLES.find((b) => b.id === id)?.scopes ?? [])];
}

/** Badge texts for a token's scopes: the bundle name when one matches, else per-scope labels. */
export function scopeBadges(scopes: readonly string[]): string[] {
	const bundle = SCOPE_BUNDLES.find((b) => b.id === bundleForScopes(scopes));
	return bundle ? [bundle.label] : scopes.map(scopeLabel);
}

export type ScopeMode = 'all' | 'selected';

/**
 * An empty list means "every scope", so "Only selected" with nothing ticked
 * would silently grant everything — it must be rejected, not submitted.
 */
export function scopeSelectionError(
	mode: ScopeMode,
	scopes: readonly string[]
): string | undefined {
	return mode === 'selected' && scopes.length === 0
		? 'Select at least one endpoint, or switch to "All endpoints".'
		: undefined;
}
