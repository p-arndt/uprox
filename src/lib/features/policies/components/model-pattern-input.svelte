<script lang="ts">
	import { untrack } from 'svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import X from '@lucide/svelte/icons/x';
	import { addModelPatterns } from '$lib/features/policies/model-pattern-chips';
	import { modelPatternError, patternMatchesKnown } from '$lib/model-patterns';

	// Model patterns as removable chips. The list still posts as one
	// comma-separated field so the server-side parsing stays the same as for the
	// former free-text input.

	let {
		id,
		name,
		value,
		suggestions = [],
		placeholder
	}: {
		id: string;
		/** form field name; posts the comma-joined patterns */
		name: string;
		/** initial comma-separated patterns */
		value: string;
		/** known model ids offered while typing; also used to flag likely typos */
		suggestions?: string[];
		placeholder?: string;
	} = $props();

	let chips = $state<string[]>(untrack(() => addModelPatterns([], value)));
	let draft = $state('');

	const listId = $derived(`${id}-suggestions`);
	const offered = $derived(suggestions.filter((s) => !chips.includes(s)));
	const errors = $derived(chips.map(modelPatternError).filter((e): e is string => e !== null));
	const unknown = $derived(
		suggestions.length === 0
			? []
			: chips.filter((c) => !modelPatternError(c) && !patternMatchesKnown(c, suggestions))
	);

	function commit() {
		if (draft.trim() === '') return;
		chips = addModelPatterns(chips, draft);
		draft = '';
	}

	function onkeydown(e: KeyboardEvent) {
		if ((e.key === 'Enter' || e.key === ',' || e.key === 'Tab') && draft.trim() !== '') {
			// Tab still moves focus after committing; only Enter/comma stay in the field
			if (e.key !== 'Tab') e.preventDefault();
			commit();
		} else if (e.key === 'Backspace' && draft === '' && chips.length > 0) {
			chips = chips.slice(0, -1);
		}
	}

	function oninput(e: Event & { currentTarget: HTMLInputElement }) {
		draft = e.currentTarget.value;
		// A pasted list, or a suggestion picked from the datalist (which browsers
		// report as a replacement, not typing), commits at once. Typing a known id
		// must not, since it may be the prefix of a longer one.
		const picked = (e as unknown as InputEvent).inputType === 'insertReplacementText';
		if (draft.includes(',') || (picked && suggestions.includes(draft.trim()))) commit();
	}

	const remove = (chip: string) => (chips = chips.filter((c) => c !== chip));
</script>

<input type="hidden" {name} value={chips.join(', ')} />
<div
	class="flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30"
>
	{#each chips as chip (chip)}
		<Badge
			variant={modelPatternError(chip)
				? 'destructive'
				: unknown.includes(chip)
					? 'outline'
					: 'secondary'}
			class="gap-1 pr-1 font-mono"
		>
			{chip}
			<button
				type="button"
				class="rounded-sm opacity-70 hover:opacity-100"
				aria-label={`Remove ${chip}`}
				onclick={() => remove(chip)}
			>
				<X class="size-3" />
			</button>
		</Badge>
	{/each}
	<input
		{id}
		list={listId}
		class="min-w-32 flex-1 bg-transparent py-0.5 outline-none placeholder:text-muted-foreground"
		placeholder={chips.length === 0 ? placeholder : 'Add another…'}
		autocomplete="off"
		bind:value={draft}
		{onkeydown}
		{oninput}
		onblur={commit}
	/>
	<datalist id={listId}>
		{#each offered as s (s)}<option value={s}></option>{/each}
	</datalist>
</div>
{#each errors as e (e)}
	<p class="text-xs text-destructive">{e}</p>
{/each}
{#if unknown.length > 0}
	<p class="text-xs text-muted-foreground">
		No known model matches {unknown.join(', ')}. Fine for custom deployments; otherwise check for
		typos.
	</p>
{/if}
