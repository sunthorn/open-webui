<script lang="ts">
	/**
	 * "Client" in the Documents menu lands here, not in finny.
	 *
	 * finny will happily render a client profile for an XPLAN id, but it cannot
	 * decide what to do when there is no client. That is axi's question —
	 * axi owns client identity — so it is answered here and finny only ever
	 * receives an id it can resolve.
	 */
	import { goto } from '$app/navigation';
	import { linkableClientId } from '$lib/apps/activeClient';
	import { finnyClientTarget } from '$lib/apps/clientTarget';

	$: target = finnyClientTarget($linkableClientId);

	// A redirect, not a render: this route is a junction, so it should never be
	// somewhere the back button can strand you.
	$: if (target.kind === 'ready') goto(target.href, { replaceState: true });
</script>

<div class="w-full h-full flex items-center justify-center px-8">
	{#if target.kind === 'none'}
		<div class="max-w-sm text-center">
			<p class="font-medium">Choose a client to see their documents</p>
			<p class="mt-2 text-sm text-gray-500">
				Documents opens straight to whoever you're working on.
			</p>
			<button
				on:click={() => goto('/apps/clients')}
				class="mt-4 text-xs font-medium text-black dark:text-white px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-850 transition"
			>
				Choose a client
			</button>
		</div>
	{:else}
		<span class="text-sm text-gray-400 dark:text-gray-600">Opening…</span>
	{/if}
</div>
