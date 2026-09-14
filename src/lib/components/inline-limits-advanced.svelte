<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import CheckboxGroup from '$lib/components/checkbox-group.svelte';
	import FieldLabel from '$lib/components/field-label.svelte';
	import SelectField from '$lib/components/select-field.svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import type { InlineLimitValues } from '$lib/components/inline-limits';
	import type { InlineLimitHints, InlineLimitScope } from '$lib/components/inline-limits-hints';

	// The collapsible "Advanced settings" part of the inline limits form:
	// access narrowing, caching and tracing, plus any parent-supplied extras.

	let {
		providers,
		values,
		idPrefix,
		scope,
		help,
		limitPlaceholder,
		extraAdvancedActive,
		advanced
	}: {
		providers: { id: string; label: string }[];
		values: InlineLimitValues;
		idPrefix: string;
		scope: InlineLimitScope;
		help: InlineLimitHints;
		limitPlaceholder: string | undefined;
		extraAdvancedActive: boolean;
		advanced?: Snippet;
	} = $props();

	const id = (field: string) => `${idPrefix}-${field}`;
	const isPolicy = untrack(() => scope === 'policy');

	// Progressive disclosure: we keep the advanced fields mounted (toggling
	// visibility, not the DOM) so they always submit — bits-ui Collapsible would
	// unmount them and silently drop values.
	const advancedActive = untrack(
		() =>
			extraAdvancedActive ||
			values.allowedProviders.length > 0 ||
			values.allowedModels !== '' ||
			values.preferredProvider !== '' ||
			values.cacheTtlSeconds !== '' ||
			values.tracingEnabled !== ''
	);
	let advancedOpen = $state(advancedActive);

	// OpenAI and Azure share the "gpt-*"/o-series namespace; pick which serves it.
	const preferredOptions = $derived([
		{ value: '', label: isPolicy ? 'No preference' : 'Inherit' },
		...providers
			.filter((p) => p.id === 'openai' || p.id === 'azure')
			.map((p) => ({ value: p.id, label: p.label }))
	]);
	let preferred = $state(untrack(() => values.preferredProvider));

	const tracingInherit = isPolicy ? 'Inherit org default' : 'Inherit';
	const tracingOptions = [
		{ value: '', label: tracingInherit },
		{ value: 'true', label: 'Always on' },
		{ value: 'false', label: 'Always off' }
	];
	let tracing = $state(untrack(() => values.tracingEnabled));
</script>

<button
	type="button"
	class="flex w-full items-center justify-between text-sm font-medium text-foreground"
	aria-expanded={advancedOpen}
	onclick={() => (advancedOpen = !advancedOpen)}
>
	<span class="flex items-center gap-2">
		Advanced settings
		{#if advancedActive}
			<span class="size-1.5 rounded-full bg-primary" title="Has custom values"></span>
		{/if}
	</span>
	<ChevronDown
		class="size-4 text-muted-foreground transition-transform duration-200 {advancedOpen
			? 'rotate-180'
			: ''}"
	/>
</button>

<div class="space-y-5" class:hidden={!advancedOpen}>
	{@render advanced?.()}

	<Separator />

	<div class="space-y-4">
		<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Access</p>
		<div class="space-y-2">
			<FieldLabel label="Allowed providers" hint={help.providers} />
			<CheckboxGroup
				name="allowedProviders"
				idPrefix={id('prov')}
				options={providers.map((p) => ({ value: p.id, label: p.label }))}
				selected={values.allowedProviders}
			/>
		</div>

		<div class="space-y-2">
			<FieldLabel for={id('allowedModels')} label="Allowed models" hint={help.models} />
			<Input
				id={id('allowedModels')}
				name="allowedModels"
				placeholder="gpt-4o*, claude-sonnet-4-6"
				value={values.allowedModels}
			/>
		</div>

		<div class="space-y-2">
			<FieldLabel
				for={id('preferredProvider')}
				label="Preferred OpenAI backend"
				hint={help.preferred}
			/>
			<SelectField
				id={id('preferredProvider')}
				name="preferredProvider"
				bind:value={preferred}
				options={preferredOptions}
			/>
		</div>
	</div>

	<Separator />

	<div class="space-y-4">
		<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
			Caching & tracing
		</p>
		<div class="grid grid-cols-2 gap-3">
			<div class="space-y-2">
				<FieldLabel for={id('cacheTtlSeconds')} label="Cache TTL (s)" hint={help.cache} />
				<Input
					id={id('cacheTtlSeconds')}
					name="cacheTtlSeconds"
					type="number"
					min="0"
					placeholder={limitPlaceholder}
					value={values.cacheTtlSeconds}
				/>
			</div>
			<div class="space-y-2">
				<FieldLabel for={id('tracingEnabled')} label="Request tracing" hint={help.tracing} />
				<SelectField
					id={id('tracingEnabled')}
					name="tracingEnabled"
					bind:value={tracing}
					options={tracingOptions}
					fallback={tracingInherit}
				/>
			</div>
		</div>
	</div>
</div>
