/**
 * Keeps the platform-default model prices current from LiteLLM's public,
 * community-maintained price list. The built-in list in providers.ts stays the
 * baseline (and the only source when the sync is off or the fetch fails);
 * LiteLLM's entries are layered on top, so a new model or a price change
 * reaches the gateway without a uprox release.
 *
 * There is exactly one writer of default rows — seedDefaultModelPrices — fed
 * the merged map, so the code list and the fetched list never take turns
 * overwriting each other. Instance overrides (custom rows) are never touched.
 *
 * Config:
 *   PRICE_SYNC=off          disable (defaults come from the code list only)
 *   PRICE_SYNC_URL=<url>    alternative source in LiteLLM's JSON format
 */
import { DEFAULT_MODEL_PRICES, type ModelPrice } from '$lib/server/providers';
import { parseLiteLLMPrices } from '$lib/server/litellm-prices';
import { hasSyncedDefaultPrices, seedDefaultModelPrices } from '$lib/server/pricing';

export const LITELLM_PRICES_URL =
	'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

const FETCH_TIMEOUT_MS = 15_000;
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETRY_INTERVAL_MS = 60 * 60 * 1000;
/**
 * A parse yielding fewer entries than this is treated as a broken or truncated
 * file and not applied. The real file maps to ~200 entries for our providers.
 */
const MIN_ENTRIES = 50;

export function priceSyncEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const v = env.PRICE_SYNC?.trim().toLowerCase();
	return !(v === 'off' || v === 'false' || v === '0');
}

/** The code list with the fetched prices layered on top (fetched wins per model). */
export function mergeDefaultPrices(
	fetched: Record<string, ModelPrice>
): Record<string, ModelPrice> {
	return { ...DEFAULT_MODEL_PRICES, ...fetched };
}

/** Download and map the LiteLLM list. Throws on network errors, timeouts or a too-small result. */
export async function fetchLiteLLMPrices(
	url = process.env.PRICE_SYNC_URL?.trim() || LITELLM_PRICES_URL,
	fetchImpl: typeof fetch = fetch
): Promise<Record<string, ModelPrice>> {
	const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	if (!res.ok) throw new Error(`price list fetch failed: HTTP ${res.status}`);
	const prices = parseLiteLLMPrices(await res.json());
	const count = Object.keys(prices).length;
	if (count < MIN_ENTRIES)
		throw new Error(`price list looks incomplete (${count} usable entries), not applied`);
	return prices;
}

/**
 * Fetch, merge and write the defaults. Returns the number of fetched entries,
 * or null on failure. Never throws: a failed sync leaves the previously synced
 * rows in place and logs a warning.
 */
export async function syncDefaultModelPrices(
	fetchPrices: () => Promise<Record<string, ModelPrice>> = () => fetchLiteLLMPrices()
): Promise<number | null> {
	try {
		const fetched = await fetchPrices();
		await seedDefaultModelPrices(mergeDefaultPrices(fetched));
		const count = Object.keys(fetched).length;
		console.log(`Model prices synced from LiteLLM (${count} entries)`);
		return count;
	} catch (error) {
		console.warn('Model price sync failed, keeping current defaults:', error);
		return null;
	}
}

/**
 * Startup seeding when the sync is on. An instance that has synced before keeps
 * its synced prices (only new code-list models are added) until the background
 * sync refreshes them. One that never has — fresh, or never able to reach the
 * source — gets the full code list, so an offline instance still picks up
 * corrected built-in prices with every release.
 */
export async function seedDefaultsForSync(): Promise<void> {
	const synced = await hasSyncedDefaultPrices();
	await seedDefaultModelPrices(DEFAULT_MODEL_PRICES, { updateExisting: !synced });
}

let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Run one sync in the background, then repeat daily (hourly after a failure).
 * Not awaited by startup, so a slow or unreachable source never delays boot.
 * Every replica syncs on its own; the write is idempotent, so that's harmless.
 */
export function startPriceSync(): void {
	if (timer) return;
	const run = async () => {
		const synced = await syncDefaultModelPrices();
		timer = setTimeout(run, synced != null ? SYNC_INTERVAL_MS : RETRY_INTERVAL_MS);
		timer.unref?.();
	};
	timer = setTimeout(run, 0);
	timer.unref?.();
}
