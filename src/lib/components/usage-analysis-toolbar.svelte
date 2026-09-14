<script lang="ts">
	import UsageGroupByPicker from '$lib/components/usage-group-by-picker.svelte';
	import UsageFilterPicker from '$lib/components/usage-filter-picker.svelte';
	import UsageFilterPills from '$lib/components/usage-filter-pills.svelte';
	import {
		USAGE_DIMENSIONS,
		FILTERABLE_DIMENSIONS,
		type UsageDimension,
		type UsageFilter,
		type UsageFilterOptions
	} from '$lib/usage-group';

	// "Group by" + "Add filter", both as fixed-width dropdowns so the command row
	// keeps its shape no matter how many dimensions a page allows. Both live in
	// the URL, so a configured view is shareable and Back walks the analysis
	// history rather than leaving the page.

	let {
		groupBy,
		filters,
		options,
		dimensions,
		onGroupBy,
		onFilters
	}: {
		groupBy: UsageDimension;
		filters: UsageFilter[];
		/** selectable values per dimension, derived from traffic in the window */
		options: UsageFilterOptions;
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
		defaultDim={filterDims[0]?.key ?? dimensions[0]}
		{onFilters}
	/>
	<UsageFilterPills {filters} {options} {onFilters} />
</div>
