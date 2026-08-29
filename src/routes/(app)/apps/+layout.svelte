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
	import { showSidebar } from '$lib/stores';
	import XplanStatusPill from '$lib/components/xplan/XplanStatusPill.svelte';
	import { activeClient, clearActiveClient } from '$lib/apps/activeClient';

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
		<!-- `relative z-[70]` is load-bearing, not decorative.
		     `backdrop-blur` is a filter, and a filter creates a NEW STACKING
		     CONTEXT. That trapped the status pill's popover: its z-[80] only
		     ranked it against its siblings inside this bar, while the bar itself
		     sat at z-auto. <main> below is also z-auto and comes later in the
		     DOM, so page content — the Clients search box, the access-tier
		     row — painted straight over the open popover.
		     Lifting the whole bar above <main> fixes every page at once,
		     because every /apps page shares this shell. -->
		<div
			class="relative z-[70] shrink-0 h-11 flex items-center border-b border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-950/40 backdrop-blur text-sm"
		>
			<!-- The bar still sits centred, but as a container rather than as a
			     huddle. `max-w-3xl mx-auto px-8` is the same container every /apps
			     page uses for its own content, so the status pill starts on the
			     page's left margin and the Change/clear pair ends on its right
			     margin -- instead of the whole group floating in the middle with
			     nothing under it lining up.
			     (/apps/settings is max-w-2xl and /apps/data-entry max-w-4xl; 3xl is
			     what the other five pages use, so those two are a shade off.) -->
			<div class="w-full max-w-3xl mx-auto px-8 flex items-center justify-between gap-3">
				<!-- Left edge: XPLAN connection + agent access. It's the precondition
				     for everything else, and its popover holds the connect checklist. -->
				<div class="shrink-0">
					<XplanStatusPill inline />
				</div>

				<!-- Right edge: what you're working on, with the actions on it. -->
				<div class="flex items-center gap-3 min-w-0">
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
