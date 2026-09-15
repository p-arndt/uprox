<script lang="ts">
	import UsageGroupByPicker from '$lib/features/usage/components/usage-group-by-picker.svelte';
	import UsageFilterPicker from '$lib/features/usage/components/usage-filter-picker.svelte';
	import UsageFilterPills from '$lib/features/usage/components/usage-filter-pills.svelte';
	import {
		USAGE_DIMENSIONS,
		FILTERABLE_DIMENSIONS,
		type UsageDimension,
		type UsageFilter,
		type UsageFilterOptions
	} from '$lib/features/usage/group';

	// "Group by" + "Add filter", both as fixed-width dropdowns so the command row
	// keeps its shape no matter how many dimensions a page allows. Both live in
	// the URL, so a configured view is shareable and Back walks the analysis
	// history rather than leaving the page.

	let {
		groupBy,
		filters,
		options,
		optionsPending = false,
		dimensions,
		onGroupBy,
		onFilters
	}: {
		groupBy: UsageDimension;
		filters: UsageFilter[];
		/** selectable values per dimension, derived from traffic in the window */
		options: UsageFilterOptions;
		/** the options are still streaming in */
		optionsPending?: boolean;
		/** which dimensions this page allows; a scoped page hides the ones that
		 *  would collapse to a single row (service, on a service-detail page) */
		dimensions: readonly UsageDimension[];
		onGroupBy: (dim: UsageDimension) => void;
		onFilters: (next: UsageFilter[]) => void;
	} = $props();

	const dims = $derived(USAGE_DIMENSIONS.filter((d) => dimensions.includes(d.key)));
	// The filter popover offers a strict subset: `meter` is groupable but has no
	// SQL predicate behind it (see FILTERABLE_DIMENSIONS).
	const filterDims = $derived(dims.filter((d) => FILTERABLE_DIMENSIONS.includes(d.key)));
</script>

<div class="flex flex-wrap items-center gap-2">
	<UsageGroupByPicker {groupBy} {dims} {onGroupBy} />
	<!-- the value list defaults to whatever this page actually allows rather
	     than a hard-coded 'service' -->
	<UsageFilterPicker
		{filters}
		{options}
		dims={filterDims}
		defaultDim={filterDims[0]?.key ?? dimensions[0] ?? groupBy}
		{onFilters}
	/>
	<UsageFilterPills {filters} {options} {optionsPending} {onFilters} />
</div>
