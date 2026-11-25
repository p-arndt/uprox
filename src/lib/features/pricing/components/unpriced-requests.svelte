<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import CircleDollarSign from '@lucide/svelte/icons/circle-dollar-sign';

	// Requests recorded without a cost because their model had no price yet. Once a
	// price exists they can be costed after the fact from their stored token counts.

	let {
		unpriced,
		canManage
	}: {
		unpriced: {
			priceable: number;
			missing: number;
			models: { model: string; requests: number; priceable: boolean }[];
		};
		canManage: boolean;
	} = $props();

	const SHOWN = 5;
	let busy = $state(false);
	const fmt = (n: number) => n.toLocaleString();
	const stillMissing = $derived(unpriced.models.filter((m) => !m.priceable));
</script>

{#if unpriced.priceable > 0 || unpriced.missing > 0}
	<Alert.Root role="status">
		<CircleDollarSign />
		<Alert.Title>
			{fmt(unpriced.priceable + unpriced.missing)} requests have no cost recorded
		</Alert.Title>
		<Alert.Description>
			<p>
				{#if unpriced.priceable > 0}
					{fmt(unpriced.priceable)} can be priced now with the current prices{#if canManage}&nbsp;—
						backfilled requests count toward spend and budgets{/if}.
				{/if}
				{#if stillMissing.length > 0}
					Still without a price:
					{#each stillMissing.slice(0, SHOWN) as m, i (m.model)}
						<code>{m.model}</code> ({fmt(m.requests)}){i < Math.min(SHOWN, stillMissing.length) - 1
							? ', '
							: ''}
					{/each}
					{#if stillMissing.length > SHOWN}
						and {stillMissing.length - SHOWN} more{/if}.
				{/if}
			</p>
			{#if canManage && unpriced.priceable > 0}
				<form
					method="post"
					action="?/backfill"
					class="mt-2"
					use:enhance={() => {
						busy = true;
						return async ({ result, update }) => {
							busy = false;
							if (result.type === 'success') {
								await update({ reset: false });
								toast.success(
									`Costs backfilled for ${fmt(Number(result.data?.count ?? 0))} requests`
								);
							} else if (result.type === 'failure') {
								toast.error(String(result.data?.message ?? 'Backfill failed'));
							} else if (result.type === 'error') {
								toast.error(result.error?.message ?? 'Backfill failed');
							}
						};
					}}
				>
					<Button type="submit" size="sm" disabled={busy}>
						{busy ? 'Backfilling…' : `Backfill ${fmt(unpriced.priceable)} costs`}
					</Button>
				</form>
			{/if}
		</Alert.Description>
	</Alert.Root>
{/if}
