<script lang="ts">
	// xplan-agent dashboard shell. Lives inside the (app) group so it inherits
	// Open WebUI's auth + store setup, but renders its own app rail and hides
	// the main chat sidebar while the planner is in the dashboard.
	import { onMount } from 'svelte';
	import { showSidebar } from '$lib/stores';
	import AppsRail from '$lib/components/apps/AppsRail.svelte';

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
	<main class="flex-1 h-full overflow-y-auto">
		<slot />
	</main>
</div>
