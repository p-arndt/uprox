/**
 * Audit log filters and labels shared by the server query and the page. Pure,
 * so the URL parsing and the label rules are unit-testable and the client can
 * import them.
 */

export const AUDIT_STATUSES = ['ok', 'denied', 'error'] as const;
export type AuditStatusFilter = (typeof AUDIT_STATUSES)[number];

export const AUDIT_KINDS = ['gateway', 'admin'] as const;
export type AuditKindFilter = (typeof AUDIT_KINDS)[number];

/** Time ranges the log can be narrowed to, in hours back from now. */
export const AUDIT_RANGES = { '1h': 1, '24h': 24, '7d': 24 * 7, '30d': 24 * 30 } as const;
export type AuditRange = keyof typeof AUDIT_RANGES;

export interface AuditFilter {
	q?: string;
	status?: AuditStatusFilter;
	kind?: AuditKindFilter;
	range?: AuditRange;
	/** id of the last row already shown; the next page starts after it */
	cursor?: string;
}

export const AUDIT_PAGE_SIZE = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const oneOf = <T extends string>(options: readonly T[], value: string | null): T | undefined =>
	options.includes(value as T) ? (value as T) : undefined;

/**
 * Read the filter from URL search params. Unknown values are dropped rather
 * than rejected: a stale bookmark should still open the log, just unfiltered.
 */
export function parseAuditFilter(params: URLSearchParams): AuditFilter {
	const q = params.get('q')?.trim();
	const cursor = params.get('cursor');
	return {
		q: q || undefined,
		status: oneOf(AUDIT_STATUSES, params.get('status')),
		kind: oneOf(AUDIT_KINDS, params.get('kind')),
		range: oneOf(Object.keys(AUDIT_RANGES) as AuditRange[], params.get('range')),
		cursor: cursor && UUID.test(cursor) ? cursor : undefined
	};
}

/** The filter as search params, omitting defaults so URLs stay short. */
export function auditFilterParams(filter: AuditFilter): URLSearchParams {
	const params = new URLSearchParams();
	if (filter.q) params.set('q', filter.q);
	if (filter.status) params.set('status', filter.status);
	if (filter.kind) params.set('kind', filter.kind);
	if (filter.range) params.set('range', filter.range);
	if (filter.cursor) params.set('cursor', filter.cursor);
	return params;
}

const GATEWAY_LABELS: Record<string, string> = {
	chat: 'Chat request',
	responses: 'Responses request',
	embeddings: 'Embeddings request',
	models: 'Model list request',
	images: 'Image request',
	files: 'Files request',
	transcriptions: 'Transcription request',
	realtime: 'Realtime session'
};

const NOUNS: Record<string, string> = {
	token: 'Token',
	policy: 'Preset',
	pricing: 'Model price',
	provider: 'Provider',
	service: 'Service',
	member: 'Member',
	settings: 'Settings',
	org: 'Organization'
};

const VERBS: Record<string, string> = {
	create: 'created',
	update: 'updated',
	upsert: 'saved',
	delete: 'deleted',
	revoke: 'revoked',
	reveal: 'revealed',
	deny: 'denied'
};

/**
 * A readable label for a raw action id (`token.revoke` → "Token revoked").
 * Unknown ids fall back to the raw id, which is still searchable.
 */
export function actionLabel(action: string): string {
	const [ns = '', verb] = action.split('.', 2);
	if (ns === 'gateway' && verb && GATEWAY_LABELS[verb]) return GATEWAY_LABELS[verb];
	if (ns === 'policy' && verb === 'deny') return 'Denied by preset';
	const noun = NOUNS[ns];
	const past = verb ? VERBS[verb] : undefined;
	return noun && past ? `${noun} ${past}` : action;
}
