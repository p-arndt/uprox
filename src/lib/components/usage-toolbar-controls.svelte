<script lang="ts">
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import UsageRangePicker from '$lib/components/usage-range-picker.svelte';
	import UsageAnalysisToolbar from '$lib/components/usage-analysis-toolbar.svelte';
	import type { UsageAnalysis } from '$lib/features/usage/types';
	import type { UsageFilterOptions } from '$lib/usage-group';
	import type { ResolvedPathname } from '$app/types';
	import { latest, type UsageView } from '$lib/state/usage-view.svelte';
	import Download from '@lucide/svelte/icons/download';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';

	// The cost-analysis command bar, shared by the usage, service and token
	// pages: window, grouping and filters on the left, refresh (and export, where
	// the page offers one) on the right.

	let {
		analysis,
		view,
		exportPath
	}: {
		analysis: UsageAnalysis;
		view: UsageView;
		/** the page's resolved CSV export endpoint; omit to hide the export menu */
		exportPath?: ResolvedPathname;
	} = $props();

	// the picker values stream in after first paint
	const filterOptions = latest(() => analysis.filterOptions);
</script>

<!-- Every control here is the same height and shape, so the row reads as a
     single band of chrome instead of assorted buttons.

     It sticks below the app header (h-14) because every panel underneath is a
     rendering of the choices made here — the page is a loop of "change the
     window, read the result", and that loop breaks the moment the controls
     scroll away and you have to travel back up to adjust them. The negative
     margins let the opaque band bleed to the padding edge of the page so
     content passing underneath is covered rather than peeking out the side. -->
<div class="sticky top-14 z-10 -mx-4 bg-background/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
	<div
		class="flex flex-col gap-2 rounded-xl border bg-card px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
	>
		<div class="flex flex-wrap items-center gap-2">
			<UsageRangePicker
				ranges={analysis.ranges}
				range={analysis.range}
				hrefWith={view.hrefWith}
				customFrom={analysis.customFrom}
				customTo={analysis.customTo}
				onApplyCustom={view.applyCustom}
			/>
			<UsageAnalysisToolbar
				groupBy={analysis.groupBy}
				filters={analysis.filters}
				dimensions={analysis.dimensions}
				options={filterOptions.current?.value ?? ({} as UsageFilterOptions)}
				optionsPending={filterOptions.current === undefined}
				onGroupBy={view.setGroupBy}
				onFilters={view.setFilters}
			/>
		</div>
		<div class="flex shrink-0 items-center gap-2">
			<Button
				variant="ghost"
				size="icon"
				class="size-8"
				onclick={view.refresh}
				disabled={view.refreshing}
				aria-label="Refresh usage"
			>
				<RefreshCw class="size-4 {view.refreshing ? 'animate-spin' : ''}" />
			</Button>
			{#if exportPath}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="outline" size="sm" class="gap-1.5">
								<Download class="size-4" />
								Export
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end">
						<DropdownMenu.Item>
							{#snippet child({ props })}
								<a {...props} href={view.exportHref(exportPath, 'breakdown')} download>
									Breakdown (CSV)
								</a>
							{/snippet}
						</DropdownMenu.Item>
						<DropdownMenu.Item>
							{#snippet child({ props })}
								<a {...props} href={view.exportHref(exportPath, 'timeseries')} download>
									Time series (CSV)
								</a>
							{/snippet}
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{/if}
		</div>
	</div>
</div>
