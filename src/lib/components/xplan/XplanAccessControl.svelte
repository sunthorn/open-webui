<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { setXplanAccess, accessMeta, type XplanAccessLevel } from '$lib/apis/gateway';

	export let level: XplanAccessLevel = 'readonly';
	const dispatch = createEventDispatcher<{ change: { level: XplanAccessLevel } }>();
	const token = () => localStorage.getItem('token') ?? '';

	const TIERS: XplanAccessLevel[] = ['lock', 'readonly', 'full'];
	let busy = false;
	let confirmFull = false; // inline confirm before stepping up to Full

	const apply = async (next: XplanAccessLevel) => {
		if (busy || next === level) return;
		if (next === 'full') {
			confirmFull = true; // Full needs a deliberate confirm
			return;
		}
		await commit(next);
	};

	const commit = async (next: XplanAccessLevel) => {
		busy = true;
		try {
			level = await setXplanAccess(token(), next);
			dispatch('change', { level });
		} catch (e) {
			console.warn('Could not set XPLAN access:', e);
		} finally {
			busy = false;
			confirmFull = false;
		}
	};
</script>

<div class="inline-flex rounded-xl border border-gray-200 dark:border-gray-700 p-0.5 gap-0.5" role="group" aria-label="XPLAN access level">
	{#each TIERS as tier}
		<button
			type="button"
			disabled={busy}
			aria-pressed={level === tier}
			on:click={() => apply(tier)}
			class="px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition disabled:opacity-50
				{level === tier
				? tier === 'lock'
					? 'bg-gray-200 dark:bg-gray-700'
					: tier === 'full'
						? 'bg-amber-500 text-white'
						: 'bg-green-500 text-white'
				: 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300'}"
		>
			{accessMeta(tier).icon}
			{accessMeta(tier).label}
		</button>
	{/each}
</div>

{#if confirmFull}
	<div class="mt-2 text-xs rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-2.5">
		<p class="text-amber-800 dark:text-amber-300">
			This lets the agent <strong>change client records</strong> in XPLAN. Continue?
		</p>
		<div class="mt-2 flex gap-2">
			<button
				type="button"
				disabled={busy}
				on:click={() => commit('full')}
				class="px-2.5 py-1 rounded-lg bg-amber-500 text-white font-medium disabled:opacity-50"
			>
				Enable Full access
			</button>
			<button
				type="button"
				on:click={() => (confirmFull = false)}
				class="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700"
			>
				Cancel
			</button>
		</div>
	</div>
{/if}
