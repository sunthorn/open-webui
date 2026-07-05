<script lang="ts">
	// Stage 1 · New Client Enquiry — initial contact & triage.
	// Scaffold: the stage's task checklist (local tick state for now). Grows into
	// welcome-pack sending, fact-find capture, and diary booking.
	const steps = [
		{ id: 'welcome', title: 'Welcome Pack', detail: 'Send the welcome pack to the prospect.' },
		{ id: 'fsg', title: 'FSG', detail: 'Provide the Financial Services Guide.' },
		{ id: 'factfind', title: 'Fact Find', detail: 'Capture initial details and needs.' },
		{ id: 'book', title: 'Book Discovery Meeting', detail: 'Schedule the discovery meeting in the diary.' }
	];
	let done: Record<string, boolean> = {};
	$: completed = steps.filter((s) => done[s.id]).length;
</script>

<div class="max-w-3xl mx-auto px-8 py-10">
	<div class="mb-8">
		<p class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Stage 1</p>
		<h1 class="text-2xl font-semibold tracking-tight mt-1">New Client Enquiry</h1>
		<p class="text-sm text-gray-500 mt-1">Initial contact &amp; triage — {completed}/{steps.length} done.</p>
	</div>

	<div class="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
		{#each steps as s}
			<label class="flex items-start gap-3 px-4 py-3.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-850 transition">
				<input type="checkbox" bind:checked={done[s.id]} class="mt-0.5 size-4 rounded accent-black dark:accent-white" />
				<div class="min-w-0">
					<p class="text-sm font-medium {done[s.id] ? 'line-through text-gray-400' : ''}">{s.title}</p>
					<p class="text-xs text-gray-500 mt-0.5">{s.detail}</p>
				</div>
			</label>
		{/each}
	</div>

	<p class="text-xs text-gray-400 mt-4">
		Stage 1 of the client process. Checklist only for now — sending, capture and diary booking come
		next.
	</p>
</div>
