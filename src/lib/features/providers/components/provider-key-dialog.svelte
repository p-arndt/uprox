<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import EntityDialog from '$lib/components/form/entity-dialog.svelte';
	import FormError from '$lib/components/form/form-error.svelte';
	import DisclosureSection from '$lib/components/form/disclosure-section.svelte';
	import { endpointPlaceholder } from '$lib/components/form/form-options';
	import {
		credentialNoun,
		keyPlaceholder,
		labelPlaceholder,
		type ProviderKeyDraft
	} from '$lib/features/providers/providers';

	let {
		adding,
		message,
		connectionFailed = false,
		onClose
	}: {
		/** the provider being added to, or null when the dialog is closed */
		adding: ProviderKeyDraft | null;
		message?: string;
		/** the connection test rejected the credential; offer "Save anyway" */
		connectionFailed?: boolean;
		onClose: () => void;
	} = $props();

	let pending = $state(false);
	// "Save anyway" skips the probe, so the pending label shouldn't claim a test
	let skipping = $state(false);
	const noun = $derived(credentialNoun(adding?.requiresEndpoint ?? false));
</script>

{#snippet labelAndPriority()}
	<div class="grid grid-cols-2 gap-3">
		<div class="space-y-2">
			<Label for="label">Label</Label>
			<Input id="label" name="label" placeholder={labelPlaceholder(adding?.provider)} />
		</div>
		<div class="space-y-2">
			<Label for="priority">Priority</Label>
			<Input id="priority" name="priority" type="number" value="0" />
		</div>
	</div>
	<p class="text-xs text-muted-foreground">
		When a service hasn't pinned a key, the highest-priority one for the provider is used.
	</p>
{/snippet}

<EntityDialog
	open={adding !== null}
	{onClose}
	title="Add {adding?.label} {noun}"
	description="Stored encrypted. We only ever show the last 4 characters. The connection is tested before saving."
>
	<form
		method="post"
		action="?/create"
		class="space-y-4"
		use:enhance={({ submitter }) => {
			pending = true;
			skipping = submitter?.getAttribute('name') === 'skipTest';
			return async ({ update }) => {
				await update();
				pending = false;
			};
		}}
	>
		<input type="hidden" name="provider" value={adding?.provider} />
		{#if adding?.requiresEndpoint}
			<div class="space-y-2">
				<Label for="baseUrl">Endpoint URL</Label>
				<Input
					id="baseUrl"
					name="baseUrl"
					type="url"
					placeholder={endpointPlaceholder(adding?.provider)}
					autocomplete="off"
					required
				/>
				{#if adding?.provider === 'custom'}
					<p class="text-xs text-muted-foreground">
						The base URL of any OpenAI-compatible API — Groq, OpenRouter, Together, or a self-hosted
						vLLM/Ollama/LiteLLM. Used as-is, so include the full path (e.g.
						<code>/v1</code>). Call models by their exact name.
					</p>
				{:else if adding?.provider === 'ollama'}
					<p class="text-xs text-muted-foreground">
						Your Ollama host. Plain <code>http://</code> is fine; the <code>/v1</code> path is added
						automatically. Call models by their exact name (e.g.
						<code>llama3.2</code>).
					</p>
				{:else}
					<p class="text-xs text-muted-foreground">
						Your Azure resource endpoint. Call models by their deployment name (e.g.
						<code>gpt-4o</code>) — no prefix. Add one key per resource and pick it on each service.
					</p>
				{/if}
			</div>
		{/if}
		{#if adding?.authScheme === 'basic'}
			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-2">
					<Label for="username">Username</Label>
					<Input id="username" name="username" autocomplete="off" />
				</div>
				<div class="space-y-2">
					<Label for="password">Password</Label>
					<Input id="password" name="password" type="password" autocomplete="off" />
				</div>
			</div>
			<p class="text-xs text-muted-foreground">
				Optional HTTP basic auth, sent on every upstream request — leave both blank if your endpoint
				needs no credentials.
			</p>
		{:else}
			<div class="space-y-2">
				<Label for="secret">API key</Label>
				<Input
					id="secret"
					name="secret"
					type="password"
					placeholder={keyPlaceholder(adding?.provider)}
					autocomplete="off"
					required
				/>
			</div>
		{/if}
		{#if adding?.hasKeys}
			{@render labelAndPriority()}
		{:else}
			<!-- a first key needs neither: there is nothing to tell it apart from yet -->
			<DisclosureSection title="Advanced" summary="Label, priority">
				{@render labelAndPriority()}
			</DisclosureSection>
		{/if}
		<FormError {message} />
		<Dialog.Footer>
			<!-- the primary button comes first in the DOM so Enter re-runs the test
			     instead of submitting "Save anyway" -->
			<Button type="submit" disabled={pending}>
				{pending ? (skipping ? 'Saving…' : 'Testing connection…') : `Save ${noun}`}
			</Button>
			{#if connectionFailed}
				<Button
					type="submit"
					name="skipTest"
					value="1"
					variant="outline"
					class="sm:order-first"
					disabled={pending}
				>
					Save anyway
				</Button>
			{/if}
		</Dialog.Footer>
	</form>
</EntityDialog>
