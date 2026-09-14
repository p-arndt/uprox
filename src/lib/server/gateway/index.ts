/**
 * The LLM gateway: authenticates machine tokens, routes requests to upstream
 * providers and applies policy, rate limits, budgets, caching, cost accounting
 * and audit on the way.
 *
 *   envelope          error response shapes (OpenAI, native Gemini)
 *   authenticate      machine-token auth and request headers
 *   credentials       upstream provider secrets
 *   context           per-request context, audit trace, audited rejections
 *   resolve-provider  model-based provider routing
 *   guards            capability, policy, rate limit, cache replay, budget
 *   upstream          upstream fetch and failure handling
 *   record-usage      usage extraction and the cost/audit/cache recorder
 *   stream            SSE pass-through tap and streamed recording
 *   pipeline          JSON, multipart and native Gemini pipelines
 *   passthrough       Gemini model discovery and the Files API
 *   endpoints         endpoint descriptors and route handler factories
 */
export {
	gatewayError,
	openAiEnvelope,
	geminiEnvelope,
	type ErrorKind,
	type ErrorEnvelope
} from './envelope';
export { authenticateGateway, type GatewayAuth } from './authenticate';
export { loadProviderCreds } from './credentials';
export {
	makeAuditTrace,
	type AuditTrace,
	type AuditTraceOptions,
	type TraceResponse
} from './context';
export type { UsageExtractor } from './record-usage';
export { tapSseStream, type DrainedSse } from './stream';
export {
	proxyToProvider,
	proxyMultipartToProvider,
	proxyGeminiNative,
	type ProxyOptions,
	type MultipartProxyOptions,
	type NativeGeminiOptions
} from './pipeline';
export { proxyGeminiModels, proxyRawUpstream, type RawProxyOptions } from './passthrough';
export {
	ENDPOINTS,
	gatewayEndpoint,
	filesEndpoint,
	azureStyle,
	azureDeployment,
	resolveJsonModel,
	realtimeClientSecretModel,
	realtimeSessionModel,
	realtimeTranscriptionSessionModel,
	type EndpointDescriptor,
	type ModelSource
} from './endpoints';
