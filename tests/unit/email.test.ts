import { describe, it, expect } from 'vitest';
import { escapeHtml } from '$lib/server/email';

/**
 * Regression for the email HTML-injection fix: values interpolated into the
 * invitation/budget-alert HTML bodies (inviter display name, org name, role,
 * service name, URLs) must be HTML-escaped so an attacker-influenceable name
 * can't inject markup into the rendered email.
 */
describe('escapeHtml (email HTML-injection guard)', () => {
	it('neutralizes a script-tag injection', () => {
		const out = escapeHtml('<script>alert(1)</script>');
		expect(out).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
		expect(out).not.toContain('<script>');
	});

	it('escapes attribute-breaking quotes so injected href/markup is inert', () => {
		const out = escapeHtml('" onmouseover="evil()');
		expect(out).not.toContain('"');
		expect(out).toContain('&quot;');
	});

	it('escapes all five HTML-significant characters', () => {
		expect(escapeHtml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#39;');
	});

	it('escapes & first so existing entities are not double-mangled into valid markup', () => {
		// "<" must become "&lt;", never "&amp;lt;" turning back into a tag elsewhere
		expect(escapeHtml('a<b')).toBe('a&lt;b');
		expect(escapeHtml('&amp;')).toBe('&amp;amp;');
	});

	it('leaves benign text untouched', () => {
		expect(escapeHtml('Ada Lovelace')).toBe('Ada Lovelace');
	});
});
