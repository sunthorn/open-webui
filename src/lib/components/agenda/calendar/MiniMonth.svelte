<script lang="ts">
	// A small month to jump to any date. Its month steps on its own; picking
	// a day dispatches it and leaves closing to the parent.
	import { createEventDispatcher } from 'svelte';
	import { monthGrid, monthTitle, stepAnchor, parseDay } from '$lib/apps/agendaCalendar';

	export let value: string; // the calendar's anchor
	export let today: string;
	/** Days the calendar is showing, shaded so the planner sees where they are. */
	export let from = '';
	export let to = '';

	const dispatch = createEventDispatcher<{ pick: string }>();
	let month = value;
	$: grid = monthGrid(month);
	const heads = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
</script>

<div class="w-64 p-3 select-none">
	<div class="flex items-center justify-between mb-2">
		<button
			type="button"
			class="size-7 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
			aria-label="Previous month"
			on:click={() => (month = stepAnchor('month', month, -1))}>‹</button
		>
		<span class="text-sm font-medium">{monthTitle(month)}</span>
		<button
			type="button"
			class="size-7 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
			aria-label="Next month"
			on:click={() => (month = stepAnchor('month', month, 1))}>›</button
		>
	</div>
	<div class="grid grid-cols-7 text-center text-[10px] text-gray-400 mb-1" aria-hidden="true">
		{#each heads as h}<span>{h}</span>{/each}
	</div>
	<div
		class="grid grid-cols-7 gap-y-0.5 text-center text-xs"
		role="grid"
		aria-label={monthTitle(month)}
	>
		{#each grid as c (c.day)}
			{@const inRange = from && c.day >= from && c.day <= to}
			<button
				type="button"
				role="gridcell"
				aria-label={parseDay(c.day).toDateString()}
				aria-selected={c.day === value}
				class="h-7 rounded-md tabular-nums transition
					{c.inMonth ? '' : 'text-gray-300 dark:text-gray-600'}
					{inRange ? 'bg-gray-100 dark:bg-gray-800' : ''}
					{c.day === today ? 'font-semibold text-red-600 dark:text-red-400' : ''}
					hover:bg-gray-200 dark:hover:bg-gray-700"
				on:click={() => dispatch('pick', c.day)}>{parseDay(c.day).getDate()}</button
			>
		{/each}
	</div>
	<button
		type="button"
		class="mt-2 w-full text-xs py-1 rounded-md border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
		on:click={() => dispatch('pick', today)}>Today</button
	>
</div>
