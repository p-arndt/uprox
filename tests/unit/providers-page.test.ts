import { describe, it, expect } from 'vitest';
import {
	connectionTestToast,
	credentialNoun,
	keyPlaceholder,
	labelPlaceholder,
	maskedHint,
	savedToast
} from '$lib/features/providers/providers';
import { setupChecklistRedirect } from '$lib/server/setup-progress';
import { NAV_SECTIONS } from '$lib/nav';

describe('provider key form hints', () => {
	it('shapes the key placeholder like the provider keys', () => {
		expect(keyPlaceholder('gemini')).toBe('AIza…');
		expect(keyPlaceholder('anthropic')).toBe('sk-ant-…');
		expect(keyPlaceholder('custom')).toBe('API key');
	});

	it('gives endpoint providers their own label example and noun', () => {
		expect(labelPlaceholder('azure')).toBe('e.g. Azure East US');
		expect(labelPlaceholder('openai')).toBe('e.g. Production');
		expect(credentialNoun(true)).toBe('endpoint');
		expect(credentialNoun(false)).toBe('key');
	});

	it('masks a hint but says "No auth" for an empty credential', () => {
		expect(maskedHint('beef')).toBe('••••beef');
		expect(maskedHint('')).toBe('No auth');
		expect(maskedHint(null)).toBe('No auth');
	});
});

describe('providers page toasts', () => {
	it('names what happened per action', () => {
		expect(savedToast('create', true)).toBe('Connection verified, saved');
		expect(savedToast('create', false)).toBe('Saved');
		expect(savedToast('rotate')).toBe('Key rotated');
		expect(savedToast('editMeta')).toBe('Details saved');
		expect(savedToast('delete')).toBe('Key removed');
		expect(savedToast('test')).toBeNull();
	});

	it('maps a connection test outcome to a toast', () => {
		expect(connectionTestToast({ status: 'ok' })).toEqual({
			kind: 'success',
			message: 'Connection OK'
		});
		expect(connectionTestToast({ status: 'failed', message: 'Upstream returned 401' })).toEqual({
			kind: 'error',
			message: 'Upstream returned 401'
		});
		expect(connectionTestToast({ status: 'skipped', message: 'x' }).kind).toBe('info');
	});
});

describe('setupChecklistRedirect', () => {
	it('keeps a fresh instance on the checklist', () => {
		expect(setupChecklistRedirect(0, new URL('http://x/app'))).toBeNull();
	});

	it('hands over to the cost analysis once traffic exists', () => {
		expect(setupChecklistRedirect(3, new URL('http://x/app'))).toBe('/app/usage');
	});

	it('never redirects when the checklist is asked for explicitly', () => {
		expect(setupChecklistRedirect(3, new URL('http://x/app?setup'))).toBeNull();
	});
});

describe('nav', () => {
	it('lists the gateway pages in setup order', () => {
		const gateway = NAV_SECTIONS.find((s) => s.label === 'Gateway');
		expect(gateway?.items.map((i) => i.href)).toEqual([
			'/app/providers',
			'/app/services',
			'/app/tokens',
			'/app/connect'
		]);
	});
});
