<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import DatabaseZap from '@lucide/svelte/icons/database-zap';
	import SettingsCard from './settings-card.svelte';

	let { cacheTtlSeconds, readonly = false }: { cacheTtlSeconds: number; readonly?: boolean } =
		$props();
</script>

<SettingsCard
	icon={DatabaseZap}
	title="Response cache"
	description="Exact-match cache for chat & embeddings, applied to every service."
	action="updateCache"
	savedMessage="Cache settings saved"
	{readonly}
>
	<div class="space-y-2">
		<Label for="cacheTtlSeconds">Default cache TTL (seconds)</Label>
		<Input
			id="cacheTtlSeconds"
			name="cacheTtlSeconds"
			type="number"
			min="0"
			value={cacheTtlSeconds}
			class="max-w-xs"
		/>
		<p class="text-xs text-muted-foreground">
			0 disables caching org-wide. Identical requests within the TTL replay the stored response at
			zero cost (streaming included). A preset can override this per service.
		</p>
	</div>
</SettingsCard>
