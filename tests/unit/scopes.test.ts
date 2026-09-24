import { describe, it, expect } from 'vitest';
import {
	GATEWAY_SCOPES,
	SCOPE_BUNDLES,
	SCOPE_INFO,
	bundleForScopes,
	normalizeScopes,
	scopeBadges,
	scopeLabel,
	scopeSelectionError,
	scopesForBundle
} from '$lib/scopes';
import { ENDPOINTS } from '$lib/server/gateway/endpoints';

describe('SCOPE_INFO', () => {
	it('labels and describes every scope', () => {
		for (const s of GATEWAY_SCOPES) {
			expect(SCOPE_INFO[s].label).not.toBe('');
			expect(SCOPE_INFO[s].description).not.toBe('');
		}
	});

	it('mentions every proxied endpoint path in its scope description', () => {
		for (const e of Object.values(ENDPOINTS)) {
			expect(SCOPE_INFO[e.scope].description).toContain(e.path);
		}
	});
});

describe('scopeLabel', () => {
	it('falls back to the raw id for unknown scopes', () => {
		expect(scopeLabel('chat')).toBe('Chat completions');
		expect(scopeLabel('legacy')).toBe('legacy');
	});
});

describe('normalizeScopes', () => {
	it('drops unknown and duplicate ids and sorts canonically', () => {
		expect(normalizeScopes(['models', 'bogus', 'chat', 'chat'])).toEqual(['chat', 'models']);
	});
});

describe('bundleForScopes', () => {
	it('maps the empty list to all endpoints', () => {
		expect(bundleForScopes([])).toBe('all');
	});

	it('matches bundles regardless of order', () => {
		expect(bundleForScopes(['models', 'responses', 'chat'])).toBe('chat');
		expect(bundleForScopes(['models', 'embeddings'])).toBe('embeddings');
	});

	it('treats anything else as custom', () => {
		expect(bundleForScopes(['chat'])).toBe('custom');
		expect(bundleForScopes(['chat', 'responses', 'models', 'images'])).toBe('custom');
		expect(bundleForScopes(['embeddings', 'models', 'legacy'])).toBe('custom');
	});

	it('round-trips every bundle', () => {
		for (const b of SCOPE_BUNDLES) expect(bundleForScopes(scopesForBundle(b.id))).toBe(b.id);
	});
});

describe('scopesForBundle', () => {
	it('returns a fresh copy', () => {
		const a = scopesForBundle('chat');
		a.push('images');
		expect(scopesForBundle('chat')).toEqual(['chat', 'responses', 'models']);
	});
});

describe('scopeBadges', () => {
	it('shows the bundle name when one matches', () => {
		expect(scopeBadges([])).toEqual(['All endpoints']);
		expect(scopeBadges(['chat', 'responses', 'models'])).toEqual(['Chat & Responses']);
	});

	it('lists scope labels otherwise', () => {
		expect(scopeBadges(['images', 'files'])).toEqual(['Images', 'Files']);
	});
});

describe('scopeSelectionError', () => {
	it('rejects "only selected" with nothing ticked', () => {
		expect(scopeSelectionError('selected', [])).toMatch(/at least one/);
	});

	it('accepts all endpoints or a non-empty selection', () => {
		expect(scopeSelectionError('all', [])).toBeUndefined();
		expect(scopeSelectionError('selected', ['chat'])).toBeUndefined();
	});
});
