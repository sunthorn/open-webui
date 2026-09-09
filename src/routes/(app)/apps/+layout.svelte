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
	import { onMount, onDestroy } from 'svelte';
	import { showSidebar } from '$lib/stores';
	import ClientContextBar from '$lib/components/apps/ClientContextBar.svelte';
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
	<ClientContextBar showSyncJobs />

	<main class="flex-1 overflow-y-auto min-h-0">
		<slot />
	</main>
</div>
