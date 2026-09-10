<script lang="ts">
	// "Something is syncing" — on every /apps page, because it lives in the
	// layout rather than in the four pages that start the work.
	//
	// That placement IS the feature. Before this, each page owned its own
	// spinner and Stop button, so walking away from the Briefing page while it
	// refreshed left a 120-second agent call running with nothing on screen
	// saying so and no way to stop it.
	import { syncJobs, stopJob, elapsedLabel } from '$lib/stores/syncJobs';
	import { KIND_LABEL } from '$lib/apis/gateway/jobs';
	import { onDestroy } from 'svelte';

	const token = () => localStorage.getItem('token') ?? '';

	// A ticking clock for the elapsed label. Every second, and only while
	// something is running — the reactive block below re-reads `now`.
	let now = new Date();
	const clock = setInterval(() => (now = new Date()), 1000);
	onDestroy(() => clearInterval(clock));

	$: jobs = $syncJobs.running;
	// The oldest is the one actually holding the browser (concurrency is 1);
	// anything behind it is waiting its turn. Naming the running one and
	// counting the rest beats a stack of pills for a queue of two.
	$: current = jobs[0];
	$: waiting = jobs.length - 1;

	let stopping = false;
	const stop = async () => {
		if (!current || stopping) return;
		stopping = true;
		try {
			await stopJob(token(), current.id);
		} finally {
			stopping = false;
		}
	};
</script>

{#if current}
	<div
		class="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 min-w-0"
		role="status"
		aria-live="polite"
	>
		<span class="animate-spin shrink-0" aria-hidden="true">⟳</span>
		<span class="font-medium shrink-0">{KIND_LABEL[current.kind]}</span>
		<span class="text-gray-400 shrink-0">·</span>
		<span class="tabular-nums shrink-0"
			>{elapsedLabel(current.startedAt, now, current.createdAt)}</span
		>
		{#if waiting > 0}
			<span class="text-gray-400 shrink-0">+{waiting} queued</span>
		{/if}
		<button
			on:click={stop}
			disabled={stopping}
			class="shrink-0 font-medium text-red-600 hover:text-red-700 disabled:opacity-50 px-1.5 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition"
		>
			{stopping ? 'Stopping…' : 'Stop'}
		</button>
	</div>
{/if}
