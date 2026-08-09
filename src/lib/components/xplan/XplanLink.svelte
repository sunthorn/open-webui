<script lang="ts">
	// "Check the source" button — opens a real XPLAN page so the planner can see
	// the data behind what axi is showing.
	//
	// It opens in the DEBUG browser (via the gateway), not this one: the planner's
	// XPLAN session lives there, so a plain <a href> would land on a login page.
	import { openInXplan } from '$lib/apis/gateway';

	/** Site-relative XPLAN path, e.g. '/factfind/search/result?role=client'. */
	export let path: string;
	export let label = 'View in XPLAN';
	export let title = '';
	/** 'sm' suits dense card headers; 'md' matches page-header buttons. */
	export let size: 'sm' | 'md' = 'sm';

	let busy = false;
	let err = '';

	const go = async () => {
		if (busy) return;
		busy = true;
		err = '';
		try {
			await openInXplan(localStorage.getItem('token') ?? '', path);
		} catch (e: any) {
			err = typeof e === 'string' ? e : (e?.message ?? 'Could not open XPLAN');
		} finally {
			busy = false;
		}
	};
</script>

<span class="inline-flex items-center gap-2">
	<button
		type="button"
		on:click={go}
		disabled={busy}
		title={title || `Open ${path} in the debug browser`}
		class="inline-flex items-center gap-1 font-medium rounded-lg border transition
			border-gray-200 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-900
			disabled:opacity-50
			{size === 'md' ? 'text-sm px-3 py-1.5' : 'text-xs px-2.5 py-1.5'}"
	>
		{busy ? 'Opening…' : label} ↗
	</button>
	{#if err}
		<span class="text-xs text-red-600 dark:text-red-400">{err}</span>
	{/if}
</span>
