<script lang="ts">
	// One section, in full: status, stale warning, the table, provenance.
	// A couple's section arrives as two rows (one per fetchedViaId); both
	// render, stacked, each labelled with the id that produced it.
	import type { XplanClientSection } from '$lib/apis/gateway';
	import {
		isStale,
		sectionLabel,
		unmappedPanels,
		type CapturedPanel
	} from '$lib/apps/clientSections';

	export let section: string | null = null;
	export let rows: XplanClientSection[] = [];
	export let fmtAge: (iso?: string) => string;

	// Column order comes from the section's OWN headers; rows are header-keyed
	// objects ({"Description": "Home"}), never positional arrays. Falling back
	// to the first row's keys keeps a section readable if headers came back
	// empty.
	const columns = (s: XplanClientSection) =>
		s.headers?.length ? s.headers : Object.keys(s.rows?.[0] ?? {});

	// What to draw for one read: the map-promoted table when there is one,
	// otherwise every panel the scraper captured (no verified map exists yet
	// for this tenant, so this is the usual case). Both are drawn by the same
	// table markup; only the framing differs.
	const tables = (s: XplanClientSection): CapturedPanel[] =>
		s.rows?.length ? [{ heading: '', headers: columns(s), rows: s.rows }] : unmappedPanels(s);
	const isCaptured = (s: XplanClientSection) => !s.rows?.length && unmappedPanels(s).length > 0;

	// A blank XPLAN header is keyed `col<i>` (see unmappedPanels); show it blank.
	const headerLabel = (h: string) => (/^col\d+$/.test(h) ? '' : h);

	const staleReason = (s: XplanClientSection) =>
		s.status === 'changed'
			? "XPLAN's page structure changed, so this page could not be read into the usual columns. These are the last good values."
			: 'The last read of this page failed. These are the last good values.';

	const statusChip = (s: XplanClientSection) =>
		({
			ok: {
				label: 'Current',
				cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
			},
			empty: {
				label: 'Nothing recorded',
				cls: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
			},
			changed: {
				label: 'Stale · page changed',
				cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
			},
			error: {
				label: 'Stale · read failed',
				cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
			}
		})[s.status];
</script>

<section class="flex-1 min-w-0">
	{#if !section}
		<div
			class="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 px-4 py-8 text-center"
		>
			<p class="text-sm text-gray-500">Pick a section.</p>
		</div>
	{:else if !rows.length}
		<h2 class="text-base font-semibold mb-2">{sectionLabel(section)}</h2>
		<p class="text-sm text-gray-500">
			Not read yet — press <span class="font-medium">Read from XPLAN</span>.
		</p>
	{:else}
		<h2 class="text-base font-semibold mb-3">{sectionLabel(section)}</h2>
		<div class="space-y-6">
			{#each rows as s (s.fetchedViaId)}
				{@const panels = tables(s)}
				{@const captured = isCaptured(s)}
				<div class="rounded-2xl border border-gray-100 dark:border-gray-800 p-4">
					<div class="flex items-center gap-2.5 mb-3">
						{#if rows.length > 1}
							<span class="text-xs text-gray-500">read via id {s.fetchedViaId}</span>
						{/if}
						{#if s.rows?.length}
							<span class="text-xs text-gray-400 tabular-nums">{s.rows.length} rows</span>
						{:else if captured}
							<span class="text-xs text-gray-400 tabular-nums">{panels.length} panels</span>
						{/if}
						<span class="ml-auto text-[10px] px-1.5 py-0.5 rounded-full {statusChip(s).cls}">
							{statusChip(s).label}
						</span>
					</div>
					{#if isStale(s)}
						<p class="text-xs text-amber-700 dark:text-amber-400 mb-2">
							{staleReason(s)} Last read {fmtAge(s.fetchedAt)}.
						</p>
					{/if}
					{#if captured}
						<p class="text-xs text-gray-500 mb-3">
							<span class="font-medium">Captured from XPLAN · not yet mapped.</span>
							Every table on the page, as XPLAN laid it out. A verified page map will turn these into
							fixed columns.
						</p>
					{/if}
					{#if panels.length}
						<div class="space-y-4">
							{#each panels as p, pi (pi)}
								<div>
									{#if p.heading}
										<h3 class="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
											{p.heading}
										</h3>
									{/if}
									<div class="overflow-x-auto -mx-1">
										<table class="w-full text-sm border-collapse">
											<thead>
												<tr class="text-left text-xs text-gray-400 uppercase tracking-wide">
													{#each p.headers as h}
														<th class="px-1 py-1.5 font-semibold whitespace-nowrap"
															>{headerLabel(h)}</th
														>
													{/each}
												</tr>
											</thead>
											<tbody class="divide-y divide-gray-100 dark:divide-gray-800">
												{#each p.rows as row, i (i)}
													<tr>
														{#each p.headers as h}
															<td class="px-1 py-1.5 align-top">{row[h] ?? ''}</td>
														{/each}
													</tr>
												{/each}
											</tbody>
										</table>
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-sm text-gray-500">
							{section === 'tasks'
								? 'No open tasks for this client.'
								: 'Nothing recorded on this page in XPLAN.'}
						</p>
					{/if}
					<p class="text-[10px] text-gray-400 mt-2">
						page {s.pageId} · read via id {s.fetchedViaId}{s.mapVersion
							? ` · map v${s.mapVersion}`
							: section === 'tasks'
								? ' · firm to-do list, filtered'
								: ' · no verified map yet'}
					</p>
				</div>
			{/each}
		</div>
	{/if}
</section>
