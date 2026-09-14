/** Declarative endpoint descriptors and the route handler factories built from them. */
import type { RequestHandler } from '@sveltejs/kit';
import type { Capability } from '$lib/server/providers';
import { isRecord } from '$lib/server/json';
import { gatewayError } from './envelope';
import { authenticateGateway } from './authenticate';
import { proxyMultipartToProvider, proxyToProvider } from './pipeline';
import { proxyRawUpstream, type RawProxyOptions } from './passthrough';

/**
 * Where an endpoint takes the model it routes by:
 * - `'body'`: the required `model` field of the JSON body or multipart form;
 * - `'deployment'`: the `[deployment]` route param (Azure deployment URLs),
 *   written over any `model` in the body or form;
 * - a function: a custom picker over the JSON body that always yields a model
 *   (used by the realtime endpoints, where the model is optional and nested).
 */
export type ModelSource = 'body' | 'deployment' | ((body: unknown) => string);

/** Declarative description of one model-routed gateway endpoint. */
export interface EndpointDescriptor {
	/** the gateway capability (and policy scope) the endpoint exercises */
	scope: Capability;
	/** upstream path appended to the provider base url */
	path: string;
	/** how the request body is read and forwarded */
	bodyKind: 'json' | 'multipart';
	/** whether `stream: true` in a JSON body turns on streaming */
	streamable: boolean;
	/** ask pass-through upstreams for a trailing usage chunk when streaming */
	wantsUsageChunk: boolean;
	/** URL-level provider preference (Azure-style routes) */
	preferProvider?: string;
	modelFrom: ModelSource;
}

/** Routing fallback for realtime requests that carry no model. */
const REALTIME_FALLBACK_MODEL = 'gpt-realtime';

/** The first non-empty string among the candidates, else the realtime fallback. */
function firstModel(...candidates: unknown[]): string {
	for (const c of candidates) if (typeof c === 'string' && c) return c;
	return REALTIME_FALLBACK_MODEL;
}

/**
 * `POST /realtime/client_secrets`: the model lives at `session.model` in the
 * current API (top-level `model` on the legacy shape).
 */
export function realtimeClientSecretModel(body: unknown): string {
	const session = isRecord(body) && isRecord(body.session) ? body.session : undefined;
	return firstModel(session?.model, isRecord(body) ? body.model : undefined);
}

/** `POST /realtime/sessions`: the model is top-level. */
export function realtimeSessionModel(body: unknown): string {
	return firstModel(isRecord(body) ? body.model : undefined);
}

/**
 * `POST /realtime/transcription_sessions`: the model (when present) is nested
 * under `input_audio_transcription.model`.
 */
export function realtimeTranscriptionSessionModel(body: unknown): string {
	const transcription =
		isRecord(body) && isRecord(body.input_audio_transcription)
			? body.input_audio_transcription
			: undefined;
	return firstModel(transcription?.model, isRecord(body) ? body.model : undefined);
}

/**
 * The OpenAI-compatible endpoints the gateway proxies by model. Route files pick
 * one of these (optionally through {@link azureStyle} / {@link azureDeployment})
 * and hand it to {@link gatewayEndpoint}.
 */
export const ENDPOINTS = {
	chatCompletions: {
		scope: 'chat',
		path: '/chat/completions',
		bodyKind: 'json',
		streamable: true,
		// streamed chat completions carry no token counts unless asked for
		wantsUsageChunk: true,
		modelFrom: 'body'
	},
	responses: {
		scope: 'responses',
		path: '/responses',
		bodyKind: 'json',
		streamable: true,
		wantsUsageChunk: false,
		modelFrom: 'body'
	},
	embeddings: {
		scope: 'embeddings',
		path: '/embeddings',
		bodyKind: 'json',
		streamable: false,
		wantsUsageChunk: false,
		modelFrom: 'body'
	},
	imageGenerations: {
		scope: 'images',
		path: '/images/generations',
		bodyKind: 'json',
		streamable: false,
		wantsUsageChunk: false,
		modelFrom: 'body'
	},
	imageEdits: {
		scope: 'images',
		path: '/images/edits',
		bodyKind: 'multipart',
		streamable: false,
		wantsUsageChunk: false,
		modelFrom: 'body'
	},
	audioTranscriptions: {
		scope: 'transcriptions',
		path: '/audio/transcriptions',
		bodyKind: 'multipart',
		streamable: false,
		wantsUsageChunk: false,
		modelFrom: 'body'
	},
	realtimeClientSecrets: {
		scope: 'realtime',
		path: '/realtime/client_secrets',
		bodyKind: 'json',
		streamable: false,
		wantsUsageChunk: false,
		modelFrom: realtimeClientSecretModel
	},
	realtimeSessions: {
		scope: 'realtime',
		path: '/realtime/sessions',
		bodyKind: 'json',
		streamable: false,
		wantsUsageChunk: false,
		modelFrom: realtimeSessionModel
	},
	realtimeTranscriptionSessions: {
		scope: 'realtime',
		path: '/realtime/transcription_sessions',
		bodyKind: 'json',
		streamable: false,
		wantsUsageChunk: false,
		modelFrom: realtimeTranscriptionSessionModel
	}
} as const satisfies Record<string, EndpointDescriptor>;

/**
 * Azure-style URL surface (`/openai/…`, `/openai/v1/…`): same contract, but the
 * URL signals Azure intent, so it beats the policy's preferredProvider when both
 * OpenAI and Azure are configured.
 */
export function azureStyle(d: EndpointDescriptor): EndpointDescriptor {
	return { ...d, preferProvider: 'azure' };
}

/**
 * Azure deployment URL surface (`/openai/deployments/{deployment}/…`): the
 * deployment name in the URL is the canonical model name. The `api-version`
 * query string is accepted (and forwarded on multipart calls).
 */
export function azureDeployment(d: EndpointDescriptor): EndpointDescriptor {
	return { ...d, preferProvider: 'azure', modelFrom: 'deployment' };
}

/**
 * Resolve the routing model and the body to forward for a JSON endpoint. Returns
 * null when a required `model` is missing.
 */
export function resolveJsonModel(
	modelFrom: ModelSource,
	body: unknown,
	deployment: string | undefined
): { model: string; body: unknown } | null {
	if (modelFrom === 'deployment') {
		if (!deployment) return null;
		return { model: deployment, body: { ...(isRecord(body) ? body : {}), model: deployment } };
	}
	if (typeof modelFrom === 'function') return { model: modelFrom(body), body };
	const model = isRecord(body) ? body.model : undefined;
	return typeof model === 'string' && model ? { model, body } : null;
}

/**
 * Build the SvelteKit handler for a model-routed endpoint: authenticate, read the
 * JSON or multipart body, resolve the model, then run the matching pipeline.
 */
export function gatewayEndpoint(d: EndpointDescriptor): RequestHandler {
	return async (event) => {
		const auth = await authenticateGateway(event);
		if (!auth.ok) return auth.response;

		let deployment: string | undefined;
		if (d.modelFrom === 'deployment') {
			deployment = event.params.deployment;
			if (!deployment) return gatewayError(400, 'Missing deployment name');
		}

		if (d.bodyKind === 'multipart') {
			let form: FormData;
			try {
				form = await event.request.formData();
			} catch {
				return gatewayError(400, 'Request body must be multipart/form-data');
			}
			if (deployment) form.set('model', deployment);
			const model = form.get('model');
			if (typeof model !== 'string' || !model) {
				return gatewayError(400, 'Missing required field: model');
			}
			return proxyMultipartToProvider(event, {
				auth: auth.auth,
				scope: d.scope,
				model,
				path: d.path,
				form,
				preferProvider: d.preferProvider
			});
		}

		let body: unknown;
		try {
			body = await event.request.json();
		} catch {
			return gatewayError(400, 'Request body must be valid JSON');
		}
		const resolved = resolveJsonModel(d.modelFrom, body, deployment);
		if (!resolved) return gatewayError(400, 'Missing required field: model');

		return proxyToProvider(event, {
			auth: auth.auth,
			scope: d.scope,
			model: resolved.model,
			path: d.path,
			body: resolved.body,
			stream: d.streamable && isRecord(body) && body.stream === true,
			preferProvider: d.preferProvider,
			wantsUsageChunk: d.wantsUsageChunk
		});
	};
}

/**
 * Build a Files API handler (stream-through, no model routing) for a fixed
 * provider: `'list'` is `/files`, `'file'` is `/files/{id}` and `'content'` is
 * `/files/{id}/content`.
 */
export function filesEndpoint(
	provider: RawProxyOptions['provider'],
	resource: 'list' | 'file' | 'content'
): RequestHandler {
	return async (event) => {
		const auth = await authenticateGateway(event);
		if (!auth.ok) return auth.response;
		if (resource === 'list') {
			return proxyRawUpstream(event, { auth: auth.auth, provider, path: '/files' });
		}
		const id = event.params.id;
		if (!id) return gatewayError(400, 'Missing file id');
		const filePath = `/files/${encodeURIComponent(id)}`;
		return proxyRawUpstream(event, {
			auth: auth.auth,
			provider,
			path: resource === 'content' ? `${filePath}/content` : filePath
		});
	};
}
