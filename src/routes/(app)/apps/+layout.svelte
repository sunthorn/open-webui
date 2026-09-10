<script lang="ts">
	// xplan shell. Lives inside the (app) group so it inherits Open WebUI's auth
	// and store setup, and now renders BESIDE axi's sidebar rather than over it.
	//
	// It used to be a fixed inset-0 overlay at z-[60] that covered axi's chrome
	// entirely, and it collapsed the sidebar on the way in. That made sense when
	// xplan carried its own rail. With the axi rail at the layout level, the
	// overlay hid the very thing that is supposed to stay on screen: you clicked
	// xPlan and the rail vanished.
	//
	// Gone with it: the localStorage.sidebar borrow-and-restore, which existed
	// only to undo the collapse, and AppsRail, which the axi rail replaces.
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { showSidebar } from '$lib/stores';
	import XplanStatusPill from '$lib/components/xplan/XplanStatusPill.svelte';
	import SyncJobIndicator from '$lib/components/xplan/SyncJobIndicator.svelte';
	import { activeClient, clearActiveClient } from '$lib/apps/activeClient';
	import { startJobPolling, stopJobPolling, maybeStartStale } from '$lib/stores/syncJobs';

	// Poll from the LAYOUT, not from the pages. A page that owned the poll
	// would stop polling the moment you left it — which is the bug this whole
	// change exists to remove. The poll stops itself when nothing is running,
	// so an idle apps section costs one request on entry.
	// Once per visit to the apps section. maybeStartStale polls first, so this
	// covers the "start polling" job too — a running sync found here is picked
	// up and shown, whoever started it.
	onMount(() => {
		const t = localStorage.getItem('token') ?? '';
		void maybeStartStale(t).then(() => startJobPolling(t));
	});
	onDestroy(stopJobPolling);
</script>

<!-- The same width rule every other axi page uses, so the rail and the panel
     stay on screen and xplan fills what is left. -->
<div
	class="flex flex-col w-full h-screen max-h-[100dvh] min-w-0 transition-width duration-200 ease-in-out {$showSidebar
		? 'md:max-w-[calc(100%-var(--sidebar-width))]'
		: ''} max-w-full bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
>
		<!-- "Working on" context bar — the active client follows the planner across
		     every app until they pick a new one on the Clients hub. -->
		<!-- `relative z-[70]` is kept deliberately. `backdrop-blur` is a filter,
		     and a filter creates a NEW STACKING CONTEXT, so anything this bar ever
		     overlays ranks only against its own siblings unless the bar itself
		     out-ranks <main> (which is z-auto and later in the DOM). That trapped
		     the status pill's popover, back when the pill had one; the popover is
		     now the /apps/settings page and the pill is a plain link, so nothing
		     depends on this today — but the trap is one line away from returning
		     the moment anything in here floats. -->
		<div
			class="relative z-[70] shrink-0 min-h-11 py-1.5 flex items-center border-b border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-950/40 backdrop-blur text-sm"
		>
			<!-- The bar still sits centred, but as a container rather than as a
			     huddle. `max-w-3xl mx-auto px-8` is the same container every /apps
			     page uses for its own content, so the status pill starts on the
			     page's left margin and the Change/clear pair ends on its right
			     margin -- instead of the whole group floating in the middle with
			     nothing under it lining up. Every /apps page now uses this same
			     width -- data-entry was the last 4xl holdout.

			     `flex-wrap` + `ml-auto` on the right group (not `justify-between`):
			     neither side can shrink below its own content (a running sync's
			     label, an active client's name), so when both are present at once
			     they no longer fit on one line — the right group drops to its own
			     line and stays right-aligned there instead of rendering on top of
			     the left group. -->
			<div class="w-full max-w-3xl mx-auto px-8 flex flex-wrap items-center gap-x-3 gap-y-1">
				<!-- Left edge: XPLAN connection + access, then whatever is running.
				     Both are "state of the link", and both belong on every page. -->
				<div class="flex items-center gap-3 min-w-0">
					<div class="shrink-0">
						<XplanStatusPill inline />
					</div>
					<SyncJobIndicator />
				</div>

				<!-- Right edge: what you're working on, with the actions on it.
				     `ml-auto` pushes this to the right edge whether it shares the
				     first line with the left group or wraps onto its own. -->
				<div class="flex items-center gap-3 min-w-0 ml-auto">
					{#if $activeClient}
						<span class="shrink-0 text-gray-400 uppercase tracking-wide text-[11px] font-semibold"
							>Working on</span
						>
						<span class="font-medium truncate">{$activeClient.name}</span>
						<span
							class="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full {$activeClient.mode ===
							'new'
								? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
								: 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}"
						>
							{$activeClient.mode === 'new' ? 'new' : 'existing'}
						</span>
						<div class="shrink-0 flex items-center gap-1">
							<button
								on:click={() => goto('/apps/clients')}
								class="text-xs text-gray-500 hover:text-black dark:hover:text-white px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-850 transition"
							>
								Change
							</button>
							<button
								on:click={clearActiveClient}
								aria-label="Clear active client"
								class="text-gray-400 hover:text-red-500 size-6 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-850 transition"
							>
								✕
							</button>
						</div>
					{:else}
						<span class="shrink-0 text-gray-500">No client selected</span>
						<button
							on:click={() => goto('/apps/clients')}
							class="shrink-0 text-xs font-medium text-black dark:text-white px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-850 transition"
						>
							Choose a client
						</button>
					{/if}
				</div>
			</div>
		</div>

	<main class="flex-1 overflow-y-auto min-h-0">
		<slot />
	</main>
</div>
