/**
 * Adapter registry. Maps a provider id to its {@link ProviderAdapter}; a
 * provider absent from this map is proxied verbatim (the OpenAI-compatible
 * pass-through path). The gateway and the model-listing route consult
 * {@link getAdapter} to decide whether a request needs translation.
 */
import type { ProviderAdapter } from './types';
import { geminiAdapter } from './gemini';

export type { ProviderAdapter, AdapterModel } from './types';

const ADAPTERS: Record<string, ProviderAdapter> = {
	gemini: geminiAdapter
};

/** The adapter for a provider id, or null when the provider is pass-through. */
export function getAdapter(providerId: string): ProviderAdapter | null {
	return ADAPTERS[providerId] ?? null;
}
