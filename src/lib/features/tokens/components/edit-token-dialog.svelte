<script lang="ts" module>
	import type { TokenFormValues } from '$lib/features/tokens/components/token-form.svelte';

	export interface EditTokenValues extends TokenFormValues {
		/** current expiry; `undefined` when the caller doesn't know it (shown without a date) */
		expiresAt?: Date | string | null;
		/** whether the secret is currently stored for re-copying; `undefined` hides the switch */
		recopyable?: boolean;
	}
</script>

<script lang="ts">
	import TokenForm from '$lib/features/tokens/components/token-form.svelte';
	import EntityDialog from '$lib/components/form/entity-dialog.svelte';
	import type {
		InstanceDefaults,
		PresetLayerRow,
		ServiceLayerRow
	} from '$lib/features/policies/effective-config';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import SelectField from '$lib/components/form/select-field.svelte';
	import { formatDateTime } from '$lib/format';

	let {
		editing,
		onClose,
		policies,
		providers,
		services,
		canCreateService = false,
		defaults,
		message
	}: {
		editing: EditTokenValues | null;
		onClose: () => void;
		policies: (PresetLayerRow & { name: string })[];
		providers: { id: string; label: string }[];
		services: (ServiceLayerRow & { name: string; createdAt?: Date | string })[];
		canCreateService?: boolean;
		/** instance defaults, so blank limit fields can show what they inherit */
		defaults?: InstanceDefaults;
		message?: string;
	} = $props();

	// 'keep' must match KEEP_EXPIRY in $lib/server/token-actions
	const expiryOptions = [
		{ value: 'keep', label: 'Keep current' },
		{ value: '0', label: 'Never' },
		{ value: '30', label: '30 days from now' },
		{ value: '90', label: '90 days from now' },
		{ value: '365', label: '1 year from now' }
	];

	let expiresInDays = $state('keep');
	let recopyable = $state(false);
	// re-seed per opened token; the form itself remounts on id via {#key}
	$effect(() => {
		expiresInDays = 'keep';
		recopyable = editing?.recopyable ?? false;
	});

	const currentExpiry = $derived.by(() => {
		if (!editing || editing.expiresAt === undefined) return null;
		if (editing.expiresAt === null) return 'Currently never expires.';
		const past = new Date(editing.expiresAt).getTime() < Date.now();
		return `${past ? 'Expired' : 'Currently expires'} ${formatDateTime(editing.expiresAt)}.`;
	});
</script>

<!-- edit token: change its name, service, limits and access in place -->
<EntityDialog
	open={editing !== null}
	{onClose}
	title="Edit token"
	description="Adjust this token's name, service, limits and access. The secret itself never changes."
	class="max-h-[88vh] overflow-y-auto sm:max-w-lg"
>
	{#if editing}
		{#key editing.id}
			<TokenForm
				action="?/update"
				submitLabel="Save token"
				pendingLabel="Saving…"
				idPrefix="edit"
				values={editing}
				{policies}
				{providers}
				{services}
				{canCreateService}
				{defaults}
				{message}
			>
				{#snippet afterServiceFields()}
					<div class="space-y-2">
						<Label for="edit-expiresInDays">Expires</Label>
						<SelectField
							id="edit-expiresInDays"
							name="expiresInDays"
							bind:value={expiresInDays}
							options={expiryOptions}
						/>
						{#if currentExpiry}
							<p class="text-xs text-muted-foreground">{currentExpiry}</p>
						{/if}
					</div>
				{/snippet}
				{#snippet advancedFields()}
					{#if editing?.recopyable !== undefined}
						{#if editing.recopyable}
							<input type="hidden" name="recopyable" value={String(recopyable)} />
						{/if}
						<div class="space-y-1.5 rounded-lg border p-3">
							<div class="flex items-center justify-between gap-4">
								<Label for="edit-recopyable">Allow re-copying later</Label>
								<Switch
									id="edit-recopyable"
									bind:checked={recopyable}
									disabled={!editing.recopyable}
								/>
							</div>
							<p class="text-xs text-muted-foreground">
								{#if !editing.recopyable}
									This token's secret isn't stored, so re-copying can't be turned on.
								{:else if recopyable}
									The secret is stored encrypted so it can be revealed again.
								{:else}
									Saving deletes the stored secret. Re-copying can't be turned back on.
								{/if}
							</p>
						</div>
					{/if}
				{/snippet}
			</TokenForm>
		{/key}
	{/if}
</EntityDialog>
