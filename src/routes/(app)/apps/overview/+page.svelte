<script lang="ts">
	// Overview / Today — Slice 1, Stage A.
	// Layout + mock data only. Stage B replaces `data` with the live
	// PlannerOverview pulled from XPLAN via hermes (see shared-contracts).
	import { onMount } from 'svelte';

	// --- Mock data (Stage A). Shape mirrors the planned PlannerOverview DTO. ---
	const data = {
		counts: { tasksToday: 7, reviewsDue: 3, newLeads: 2 },
		todos: [
			{ id: '1', title: 'Call re: SOA sign-off', client: 'Berry, Nicholas', due: '10:30' },
			{ id: '2', title: 'Review super rollover docs', client: 'Lee, Katherine', due: '13:00' },
			{ id: '3', title: 'Prep annual review pack', client: 'Nguyen, David', due: '15:30' },
			{ id: '4', title: 'Confirm insurance beneficiary', client: 'Osei, Grace', due: '16:00' }
		]
	};

	const cards = [
		{ key: 'tasksToday', label: 'Tasks today', value: data.counts.tasksToday },
		{ key: 'reviewsDue', label: 'Reviews due', value: data.counts.reviewsDue },
		{ key: 'newLeads', label: 'New leads', value: data.counts.newLeads }
	];

	let greeting = 'Hello';
	let today = '';
	onMount(() => {
		const now = new Date();
		const h = now.getHours();
		greeting = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
		today = now.toLocaleDateString(undefined, {
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		});
	});
</script>

<div class="max-w-4xl mx-auto px-8 py-10">
	<!-- Header -->
	<div class="flex items-start justify-between gap-4 mb-8">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">{greeting}</h1>
			<p class="text-sm text-gray-500 mt-1">{today} · Today's overview</p>
		</div>
		<span
			class="shrink-0 text-[11px] font-medium px-2 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
			title="Placeholder data — live XPLAN data lands in Stage B"
		>
			mock data
		</span>
	</div>

	<!-- Summary cards -->
	<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
		{#each cards as card}
			<div
				class="rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-850 p-5"
			>
				<div class="text-3xl font-semibold tabular-nums">{card.value}</div>
				<div class="text-sm text-gray-500 mt-1">{card.label}</div>
			</div>
		{/each}
	</div>

	<!-- Today's to-do -->
	<div>
		<h2 class="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
			Today's to-do
		</h2>
		<ul class="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
			{#each data.todos as todo}
				<li class="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-850">
					<input
						type="checkbox"
						class="size-4 rounded border-gray-300 dark:border-gray-600 accent-black dark:accent-white"
						aria-label={`Mark "${todo.title}" done`}
					/>
					<div class="flex-1 min-w-0">
						<div class="text-sm font-medium truncate">{todo.title}</div>
						<div class="text-xs text-gray-500 truncate">{todo.client}</div>
					</div>
					<div class="text-xs text-gray-400 tabular-nums shrink-0">{todo.due}</div>
				</li>
			{/each}
		</ul>
		<p class="text-xs text-gray-400 mt-4">
			Slice 1 · Stage A — layout with placeholder data. Next: live tasks pulled from your
			logged-in XPLAN via hermes.
		</p>
	</div>
</div>
