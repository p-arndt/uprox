<script lang="ts">
	import { requestMessages, responseMessage } from '$lib/trace';

	let {
		requestBody,
		responseBody,
		format
	}: {
		requestBody: string | null;
		responseBody: string | null;
		format: string | null;
	} = $props();

	const messages = $derived(requestMessages(requestBody));
	const reply = $derived(responseMessage(responseBody, format));
	// the assistant reply is just another message in the transcript, appended
	// after the prompt when it carries text or tool calls.
	const conversation = $derived(reply.text || reply.toolCalls ? [...messages, reply] : messages);

	// Role → label + accent, so the conversation reads like a chat transcript.
	const roleMeta: Record<string, { label: string; accent: string }> = {
		system: { label: 'System', accent: 'border-l-amber-500' },
		developer: { label: 'Developer', accent: 'border-l-amber-500' },
		user: { label: 'User', accent: 'border-l-sky-500' },
		assistant: { label: 'Assistant', accent: 'border-l-emerald-500' },
		model: { label: 'Model', accent: 'border-l-emerald-500' },
		tool: { label: 'Tool', accent: 'border-l-violet-500' }
	};
	const meta = (role: string) =>
		roleMeta[role] ?? { label: role, accent: 'border-l-muted-foreground/40' };
</script>

{#if conversation.length === 0}
	<p class="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
		No conversation could be parsed from this payload — see the raw view.
	</p>
{:else}
	<div class="space-y-3">
		{#each conversation as m, i (i)}
			{@const mm = meta(m.role)}
			<div class="rounded-lg border border-l-2 {mm.accent} bg-card p-3">
				<div class="mb-1 text-xs font-medium text-muted-foreground">{mm.label}</div>
				{#if m.text}
					<div class="text-sm break-words whitespace-pre-wrap">{m.text}</div>
				{/if}
				{#if m.toolCalls}
					{#each m.toolCalls as call, j (j)}
						<div class="mt-2 rounded-md bg-muted/60 p-2 font-mono text-xs break-words">
							<span class="font-medium text-foreground">{call.name}(</span>{call.args}<span
								class="font-medium text-foreground">)</span
							>
						</div>
					{/each}
				{/if}
			</div>
		{/each}
	</div>
{/if}
