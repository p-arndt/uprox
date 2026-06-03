/** Shared, client-safe model classification helpers. */

/**
 * Whether a model is a text-embedding model. Embeddings are cheap and very
 * high-volume, so the usage view lets the operator exclude them from the token
 * headline. Matches OpenAI's `text-embedding-*` naming and any other model whose
 * name carries "embedding" (e.g. an Azure deployment named for the base model).
 */
export function isEmbeddingModel(model: string | null | undefined): boolean {
	return !!model && /embedding/i.test(model);
}
