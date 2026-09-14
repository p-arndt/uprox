<script lang="ts">
	import * as Tabs from '$lib/components/ui/tabs/index.js';

	// Request / response tabs showing a trace's raw payloads, already formatted
	// by the caller (see prettyJson / rawResponseBody in $lib/trace).

	let {
		request,
		response,
		emptyResponse = 'No response body was captured.',
		preClass = 'max-h-[28rem]',
		value = $bindable('request')
	}: {
		request: string;
		response: string;
		/** shown when no response body was captured */
		emptyResponse?: string;
		/** height cap for the payload block */
		preClass?: string;
		/** the active tab: 'request' | 'response' */
		value?: string;
	} = $props();
</script>

<Tabs.Root bind:value>
	<Tabs.List>
		<Tabs.Trigger value="request">Request</Tabs.Trigger>
		<Tabs.Trigger value="response">Response</Tabs.Trigger>
	</Tabs.List>
	<Tabs.Content value="request">
		{#if request}
			<pre
				class="{preClass} overflow-auto rounded-lg border bg-muted/40 p-3 text-xs">{request}</pre>
		{:else}
			<p class="text-sm text-muted-foreground">No request body was captured.</p>
		{/if}
	</Tabs.Content>
	<Tabs.Content value="response">
		{#if response}
			<pre
				class="{preClass} overflow-auto rounded-lg border bg-muted/40 p-3 text-xs">{response}</pre>
		{:else}
			<p class="text-sm text-muted-foreground">{emptyResponse}</p>
		{/if}
	</Tabs.Content>
</Tabs.Root>
