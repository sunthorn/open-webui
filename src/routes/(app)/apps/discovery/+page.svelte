<script lang="ts">
	// Stage 2 · Discovery Meeting — understand the client.
	// Scaffold: the stage's task checklist (local tick state). Grows into goals
	// capture, scope definition and a risk-profiling questionnaire.
	const steps = [
		{ id: 'goals', title: 'Clarify Goals', detail: 'What does the client want to achieve, and by when.' },
		{ id: 'collect', title: 'Collect Information', detail: 'Assets, liabilities, income, insurance, super.' },
		{ id: 'scope', title: 'Define Scope', detail: 'Agree what the advice will and won’t cover.' },
		{ id: 'risk', title: 'Risk Profiling', detail: 'Assess risk tolerance and capacity.' }
	];
	let done: Record<string, boolean> = {};
	$: completed = steps.filter((s) => done[s.id]).length;
</script>

<div class="max-w-3xl mx-auto px-8 py-10">
	<div class="mb-8">
		<p class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Stage 2</p>
		<h1 class="text-2xl font-semibold tracking-tight mt-1">Discovery Meeting</h1>
		<p class="text-sm text-gray-500 mt-1">Understand the client — {completed}/{steps.length} done.</p>
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
		Stage 2 of the client process. What’s captured here flows into Stage 3 · Data Entry &amp; Research.
	</p>
</div>
