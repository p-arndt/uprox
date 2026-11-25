import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/pricing', () => ({
	seedDefaultModelPrices: vi.fn(async () => {}),
	hasSyncedDefaultPrices: vi.fn(async () => false)
}));

import { hasSyncedDefaultPrices, seedDefaultModelPrices } from '$lib/server/pricing';
import { DEFAULT_MODEL_PRICES } from '$lib/server/providers';
import {
	fetchLiteLLMPrices,
	mergeDefaultPrices,
	priceSyncEnabled,
	seedDefaultsForSync,
	syncDefaultModelPrices
} from '$lib/server/price-sync';
import sample from '../fixtures/litellm-prices.sample.json';

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('price sync', () => {
	it('is on by default and off via PRICE_SYNC=off/false/0', () => {
		expect(priceSyncEnabled({})).toBe(true);
		for (const v of ['off', 'OFF', 'false', '0'])
			expect(priceSyncEnabled({ PRICE_SYNC: v })).toBe(false);
	});

	it('layers fetched prices over the code list, fetched winning per model', () => {
		const merged = mergeDefaultPrices({
			'gpt-4o': { in: 99, out: 99 },
			'gpt-brand-new': { in: 1, out: 2 }
		});
		expect(merged['gpt-4o']).toEqual({ in: 99, out: 99 });
		expect(merged['gpt-brand-new']).toEqual({ in: 1, out: 2 });
		expect(merged['claude-opus-5-5']).toBe(DEFAULT_MODEL_PRICES['claude-opus-5-5']);
	});

	it('refuses a fetched list with implausibly few entries', async () => {
		const fetchImpl = vi.fn(async () => jsonResponse(sample)) as unknown as typeof fetch;
		await expect(fetchLiteLLMPrices('https://example.test/p.json', fetchImpl)).rejects.toThrow(
			/incomplete/
		);
	});

	it('rejects non-2xx responses', async () => {
		const fetchImpl = vi.fn(async () => jsonResponse({}, 503)) as unknown as typeof fetch;
		await expect(fetchLiteLLMPrices('https://example.test/p.json', fetchImpl)).rejects.toThrow(
			/HTTP 503/
		);
	});

	it('writes the merged map once on success', async () => {
		vi.mocked(seedDefaultModelPrices).mockClear();
		const count = await syncDefaultModelPrices(async () => ({
			'gpt-brand-new': { in: 1, out: 2 }
		}));
		expect(count).toBe(1);
		expect(seedDefaultModelPrices).toHaveBeenCalledTimes(1);
		const written = vi.mocked(seedDefaultModelPrices).mock.calls[0]![0]!;
		expect(written['gpt-brand-new']).toEqual({ in: 1, out: 2 });
		expect(written['claude-haiku-5-5']).toBe(DEFAULT_MODEL_PRICES['claude-haiku-5-5']);
	});

	it('writes nothing and does not throw when the fetch fails', async () => {
		vi.mocked(seedDefaultModelPrices).mockClear();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const ok = await syncDefaultModelPrices(async () => {
			throw new Error('offline');
		});
		expect(ok).toBeNull();
		expect(seedDefaultModelPrices).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	it('seeds the full code list on an instance that never synced, insert-only once it has', async () => {
		vi.mocked(seedDefaultModelPrices).mockClear();
		vi.mocked(hasSyncedDefaultPrices).mockResolvedValueOnce(false);
		await seedDefaultsForSync();
		expect(seedDefaultModelPrices).toHaveBeenLastCalledWith(DEFAULT_MODEL_PRICES, {
			updateExisting: true
		});
		vi.mocked(hasSyncedDefaultPrices).mockResolvedValueOnce(true);
		await seedDefaultsForSync();
		expect(seedDefaultModelPrices).toHaveBeenLastCalledWith(DEFAULT_MODEL_PRICES, {
			updateExisting: false
		});
	});
});
