import { describe, it, expect } from 'vitest';
import {
	ENDPOINTS,
	azureStyle,
	azureDeployment,
	resolveJsonModel,
	realtimeClientSecretModel,
	realtimeSessionModel,
	realtimeTranscriptionSessionModel
} from '$lib/server/gateway';

describe('ENDPOINTS', () => {
	it('only asks for a trailing usage chunk on chat completions', () => {
		const wanting = Object.entries(ENDPOINTS)
			.filter(([, d]) => d.wantsUsageChunk)
			.map(([name]) => name);
		expect(wanting).toEqual(['chatCompletions']);
	});

	it('only lets chat completions and responses stream', () => {
		const streamable = Object.entries(ENDPOINTS)
			.filter(([, d]) => d.streamable)
			.map(([name]) => name)
			.sort();
		expect(streamable).toEqual(['chatCompletions', 'responses']);
	});

	it('reads image edits and transcriptions as multipart', () => {
		expect(ENDPOINTS.imageEdits.bodyKind).toBe('multipart');
		expect(ENDPOINTS.audioTranscriptions.bodyKind).toBe('multipart');
		expect(ENDPOINTS.imageGenerations.bodyKind).toBe('json');
	});
});

describe('Azure descriptor variants', () => {
	it('azureStyle prefers Azure and keeps the model source', () => {
		const d = azureStyle(ENDPOINTS.embeddings);
		expect(d.preferProvider).toBe('azure');
		expect(d.modelFrom).toBe('body');
		expect(d.path).toBe('/embeddings');
	});

	it('azureDeployment prefers Azure and routes by the deployment param', () => {
		const d = azureDeployment(ENDPOINTS.chatCompletions);
		expect(d.preferProvider).toBe('azure');
		expect(d.modelFrom).toBe('deployment');
		expect(d.wantsUsageChunk).toBe(true);
	});

	it('does not mutate the shared descriptors', () => {
		azureDeployment(ENDPOINTS.responses);
		expect(ENDPOINTS.responses).not.toHaveProperty('preferProvider');
		expect(ENDPOINTS.responses.modelFrom).toBe('body');
	});
});

describe('resolveJsonModel', () => {
	it('requires a non-empty string model from the body', () => {
		const body = { model: 'gpt-4o', messages: [] };
		expect(resolveJsonModel('body', body, undefined)).toEqual({ model: 'gpt-4o', body });
		expect(resolveJsonModel('body', { model: '' }, undefined)).toBeNull();
		expect(resolveJsonModel('body', { model: 42 }, undefined)).toBeNull();
		expect(resolveJsonModel('body', null, undefined)).toBeNull();
	});

	it('writes the deployment over the body model', () => {
		expect(resolveJsonModel('deployment', { model: 'ignored', stream: true }, 'my-gpt')).toEqual({
			model: 'my-gpt',
			body: { model: 'my-gpt', stream: true }
		});
		expect(resolveJsonModel('deployment', {}, undefined)).toBeNull();
	});

	it('uses a custom picker as-is', () => {
		const body = { session: { model: 'gpt-realtime-mini' } };
		expect(resolveJsonModel(realtimeClientSecretModel, body, undefined)).toEqual({
			model: 'gpt-realtime-mini',
			body
		});
	});
});

describe('realtime model pickers', () => {
	it('client secrets prefer session.model, then model, then the fallback', () => {
		expect(realtimeClientSecretModel({ session: { model: 'a' }, model: 'b' })).toBe('a');
		expect(realtimeClientSecretModel({ model: 'b' })).toBe('b');
		expect(realtimeClientSecretModel({})).toBe('gpt-realtime');
	});

	it('sessions read the top-level model', () => {
		expect(realtimeSessionModel({ model: 'gpt-4o-realtime-preview' })).toBe(
			'gpt-4o-realtime-preview'
		);
		expect(realtimeSessionModel('not an object')).toBe('gpt-realtime');
	});

	it('transcription sessions prefer the nested transcription model', () => {
		expect(
			realtimeTranscriptionSessionModel({
				input_audio_transcription: { model: 'gpt-4o-transcribe' },
				model: 'x'
			})
		).toBe('gpt-4o-transcribe');
		expect(realtimeTranscriptionSessionModel({ input_audio_transcription: {} })).toBe(
			'gpt-realtime'
		);
	});
});
