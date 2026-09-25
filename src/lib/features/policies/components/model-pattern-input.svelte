<script lang="ts">
	import { untrack } from 'svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import X from '@lucide/svelte/icons/x';
	import { addModelPatterns, matchSuggestions } from '$lib/features/policies/model-pattern-chips';
	import { modelPatternError, patternMatchesKnown } from '$lib/model-patterns';

	// Model patterns as removable chips. The list still posts as one
	// comma-separated field so the server-side parsing stays the same as for the
	// former free-text input. Suggestions use an own listbox instead of a native
	// <datalist>: browsers render that with their own chrome (arrow, focus ring)
	// that clashes with the field, and it can't match mid-string.

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
	// Opened by typing or ArrowDown, closed after a pick: a list left open over
	// the rest of the form swallows clicks meant for the fields below it.
	let listOpen = $state(false);
	let active = $state(-1);
	let input = $state<HTMLInputElement>();

	const listId = $derived(`${id}-suggestions`);
	const matches = $derived(matchSuggestions(suggestions, chips, draft));
	const open = $derived(listOpen && matches.length > 0);
	const highlighted = $derived(active >= 0 ? matches[active] : undefined);
	const errors = $derived(chips.map(modelPatternError).filter((e): e is string => e !== null));
	const unknown = $derived(
		suggestions.length === 0
			? []
			: chips.filter((c) => !modelPatternError(c) && !patternMatchesKnown(c, suggestions))
	);

	// a new query starts without a highlighted row, so Enter keeps what was typed
	$effect(() => {
		void draft;
		active = -1;
	});

	function add(raw: string) {
		if (raw.trim() === '') return;
		chips = addModelPatterns(chips, raw);
		draft = '';
		listOpen = false;
	}

	/** Arrow/Escape handling for the suggestion list; true when the key was used. */
	function navigateList(e: KeyboardEvent): boolean {
		if (e.key === 'ArrowDown' && !open && matches.length > 0) {
			listOpen = true;
			active = 0;
		} else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && open) {
			const step = e.key === 'ArrowDown' ? 1 : -1;
			active = (active + step + matches.length) % matches.length;
		} else if (e.key === 'Escape' && open) {
			listOpen = false;
		} else if (e.key === 'Enter' && open && highlighted) {
			add(highlighted);
		} else {
			return false;
		}
		e.preventDefault();
		return true;
	}

	function onkeydown(e: KeyboardEvent) {
		if (navigateList(e)) return;
		if ((e.key === 'Enter' || e.key === ',' || e.key === 'Tab') && draft.trim() !== '') {
			// Tab still moves focus after adding; Enter must not submit the whole form
			if (e.key !== 'Tab') e.preventDefault();
			add(draft);
		} else if (e.key === 'Backspace' && draft === '' && chips.length > 0) {
			chips = chips.slice(0, -1);
		}
	}

	function oninput() {
		listOpen = draft.trim() !== '';
		// a pasted list commits at once
		if (draft.includes(',')) add(draft);
	}

	const remove = (chip: string) => (chips = chips.filter((c) => c !== chip));
</script>

<input type="hidden" {name} value={chips.join(', ')} />
<div class="relative">
	<!-- clicking the padding around the chips should still focus the text field -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="flex min-h-9 w-full cursor-text flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30"
		onclick={() => input?.focus()}
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
			bind:this={input}
			role="combobox"
			aria-expanded={open}
			aria-controls={listId}
			aria-autocomplete="list"
			aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
			class="min-w-32 flex-1 appearance-none border-0 bg-transparent py-0.5 shadow-none outline-none placeholder:text-muted-foreground focus:ring-0 focus:outline-none"
			placeholder={chips.length === 0 ? placeholder : 'Add another…'}
			autocomplete="off"
			spellcheck="false"
			bind:value={draft}
			{onkeydown}
			{oninput}
			onblur={() => {
				listOpen = false;
				add(draft);
			}}
		/>
	</div>
	{#if open}
		<ul
			id={listId}
			role="listbox"
			class="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md"
		>
			{#each matches as m, i (m)}
				<li
					id={`${listId}-${i}`}
					role="option"
					aria-selected={i === active}
					class="cursor-pointer rounded-sm px-2 py-1.5 font-mono text-xs {i === active
						? 'bg-accent text-accent-foreground'
						: 'hover:bg-accent/60'}"
					onmousedown={(e) => {
						// keep focus in the input so the list doesn't close before the pick lands
						e.preventDefault();
						add(m);
					}}
					onmouseenter={() => (active = i)}
				>
					{m}
				</li>
			{/each}
		</ul>
	{/if}
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
