<script lang="ts">
	/**
	 * "Working on" — the active client, on every screen that can act on one.
	 *
	 * This used to live inside the xPlan shell layout, which meant the client
	 * stopped at the edge of /apps: you picked someone in xPlan, opened
	 * Documents, and the app had no idea who you meant. It now renders from two
	 * layouts — /apps and /x — and in /x it sits in the PARENT, above the
	 * iframe. The framed apps never see it and stay unaware they are scoped.
	 */
	import XplanStatusPill from '$lib/components/xplan/XplanStatusPill.svelte';
	import SyncJobIndicator from '$lib/components/xplan/SyncJobIndicator.svelte';
	import ClientPicker from './ClientPicker.svelte';
	import { activeClient, clearActiveClient } from '$lib/apps/activeClient';

	/**
	 * Sync-job state belongs to xPlan's own data sync. Opening Documents should
	 * not put a running-sync label on screen, and — more to the point — the
	 * /apps layout owns the poll that feeds it. Off unless asked for.
	 */
	export let showSyncJobs = false;

	let picking = false;
</script>

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
	     neither side can shrink below its own content (a running sync's label,
	     an active client's name), so when both are present at once they no
	     longer fit on one line — the right group drops to its own line and stays
	     right-aligned there instead of rendering on top of the left group. -->
	<div class="w-full max-w-3xl mx-auto px-8 flex flex-wrap items-center gap-x-3 gap-y-1">
		<!-- Left edge: XPLAN connection + access, then whatever is running.
		     Both are "state of the link", and both belong on every page. -->
		<div class="flex items-center gap-3 min-w-0">
			<div class="shrink-0">
				<XplanStatusPill inline />
			</div>
			{#if showSyncJobs}
				<SyncJobIndicator />
			{/if}
		</div>

		<!-- Right edge: what you're working on, with the actions on it.
		     `ml-auto` pushes this to the right edge whether it shares the
		     first line with the left group or wraps onto its own. -->
		<div class="relative flex items-center gap-3 min-w-0 ml-auto">
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
						on:click={() => (picking = true)}
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
					on:click={() => (picking = true)}
					class="shrink-0 text-xs font-medium text-black dark:text-white px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-850 transition"
				>
					Choose a client
				</button>
			{/if}
			{#if picking}
				<ClientPicker on:close={() => (picking = false)} />
			{/if}
		</div>
	</div>
</div>
