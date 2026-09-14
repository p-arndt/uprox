import { describe, expect, it } from 'vitest';
import { inlineLimitHints } from '$lib/components/inline-limits-hints';

describe('inlineLimitHints', () => {
	it('describes a policy as the concrete base layer', () => {
		const h = inlineLimitHints('policy');
		expect(h.rate).toBe('0 = unlimited.');
		expect(h.budget).toBe(
			'Spend ceiling for whatever inherits this preset. 0 = unlimited. UTC windows.'
		);
		expect(h.providers).toBe('None checked = all providers allowed.');
	});

	it('describes token and service limits as inheriting overrides', () => {
		expect(inlineLimitHints('token').budget).toBe(
			"This token's spend cap, on top of the service ceiling. Blank = inherit, 0 = unlimited. UTC windows."
		);
		expect(inlineLimitHints('service').budget).toBe(
			'Aggregate ceiling across all of this service’s tokens. Blank = inherit, 0 = unlimited. UTC windows.'
		);
		expect(inlineLimitHints('service').rate).toBe('Blank = inherit, 0 = unlimited.');
	});
});
