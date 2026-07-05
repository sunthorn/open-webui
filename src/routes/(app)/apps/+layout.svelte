<script lang="ts">
	// xplan-agent dashboard shell. Lives inside the (app) group so it inherits
	// Open WebUI's auth + store setup, but renders its own app rail and hides
	// the main chat sidebar while the planner is in the dashboard.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { showSidebar } from '$lib/stores';
	import AppsRail from '$lib/components/apps/AppsRail.svelte';
	import { activeClient, clearActiveClient } from '$lib/apps/activeClient';

	onMount(() => {
		// Collapse the OWUI chat sidebar so the dashboard owns the viewport.
		showSidebar.set(false);
	});
</script>

<!-- Full-viewport overlay so the dashboard fully replaces OWUI's chrome
     (chat sidebar + main menu) instead of rendering beside it and overlapping. -->
<div
	class="fixed inset-0 z-[60] flex flex-row h-screen w-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
>
	<AppsRail />
	<div class="flex-1 h-full flex flex-col min-w-0">
		<!-- "Working on" context bar — the active client follows the planner across
		     every app until they pick a new one on the Clients hub. -->
		<div
			class="shrink-0 h-11 px-5 flex items-center gap-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-950/40 backdrop-blur text-sm"
		>
			{#if $activeClient}
				<span class="text-gray-400 uppercase tracking-wide text-[11px] font-semibold">Working on</span>
				<span class="font-medium truncate">{$activeClient.name}</span>
				<span
					class="text-[10px] font-medium px-1.5 py-0.5 rounded-full {$activeClient.mode === 'new'
						? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
						: 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}"
				>
					{$activeClient.mode === 'new' ? 'new' : 'existing'}
				</span>
				<div class="ml-auto flex items-center gap-1">
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
				<span class="text-gray-500">No client selected</span>
				<button
					on:click={() => goto('/apps/clients')}
					class="ml-auto text-xs font-medium text-black dark:text-white px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-850 transition"
				>
					Choose a client
				</button>
			{/if}
		</div>

		<main class="flex-1 overflow-y-auto min-h-0">
			<slot />
		</main>
	</div>
</div>
