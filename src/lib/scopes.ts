/**
 * Canonical list of gateway scopes (a.k.a. provider capabilities). This is the
 * single source of truth shared by the policy engine, the provider registry,
 * and the dashboard token UI — so a token can never be scoped for, nor a
 * provider claim, something that isn't a real gateway endpoint.
 *
 * Kept outside `$lib/server` so the client (token creation form) can import it.
 */
export const GATEWAY_SCOPES = ['chat', 'responses', 'embeddings', 'models', 'images'] as const;

export type Capability = (typeof GATEWAY_SCOPES)[number];
