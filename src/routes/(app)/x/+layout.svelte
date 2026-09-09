<script lang="ts">
	/**
	 * The shell for a federated app: axi's client bar, then the app.
	 *
	 * The width rule is the same one every other axi page uses. Without it the
	 * pane spans the full viewport and runs UNDER the sidebar, which is
	 * translucent — so the app's own list shows through axi's menu as a ghost.
	 * It lives here now rather than in the framed page, because the bar and the
	 * frame have to share one full-height column.
	 */
	import ClientContextBar from '$lib/components/apps/ClientContextBar.svelte';
	import { showSidebar } from '$lib/stores';
</script>

<div
	class="relative flex flex-col w-full h-screen max-h-[100dvh] min-w-0 transition-width duration-200 ease-in-out {$showSidebar
		? 'md:max-w-[calc(100%-var(--sidebar-width))]'
		: ''} max-w-full bg-white dark:bg-gray-900"
>
	<ClientContextBar />
	<div class="flex-1 min-h-0">
		<slot />
	</div>
</div>
