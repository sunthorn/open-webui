<script lang="ts">
	// Hour rows for one day with every source's events overlaid. Layout maths
	// (range, placement) is in $lib/apps/agenda.ts so it is unit-tested.
	import { createEventDispatcher } from 'svelte';
	import type { AgendaEvent } from '$lib/apis/gateway/agenda';
	import { SOURCE_META, allDayOn, eventsOn, placeEvent, timelineRange } from '$lib/apps/agenda';

	export let events: AgendaEvent[] = [];
	export let day: string; // YYYY-MM-DD, local

	const dispatch = createEventDispatcher<{ select: AgendaEvent }>();

	$: range = timelineRange(events, day);
	$: hours = Array.from({ length: range.endHour - range.startHour }, (_, i) => range.startHour + i);
	$: timed = eventsOn(events, day);
	$: allDay = allDayOn(events, day);
	$: heightPx = Math.max(360, hours.length * 48);

	const hhmm = (iso: string) => {
		const d = new Date(iso);
		return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
	};
</script>

{#if allDay.length}
	<div class="flex flex-wrap gap-2 mb-3">
		{#each allDay as e}
			<button type="button" on:click={() => dispatch('select', e)}
				class="text-xs px-2 py-1 rounded-md text-white truncate max-w-xs"
				style="background:{SOURCE_META[e.source].color}">{e.title}</button>
		{/each}
	</div>
{/if}

<div class="relative rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden" style="height:{heightPx}px">
	{#each hours as h, i}
		<div class="absolute left-0 right-0 border-t border-gray-100 dark:border-gray-800 flex"
			style="top:{(i / hours.length) * 100}%; height:{100 / hours.length}%">
			<span class="w-12 shrink-0 text-[10px] text-gray-400 pl-2 pt-0.5 tabular-nums">{String(h).padStart(2, '0')}:00</span>
		</div>
	{/each}
	{#if timed.length === 0}
		<p class="absolute inset-0 flex items-center justify-center text-sm text-gray-400">Nothing scheduled.</p>
	{/if}
	{#each timed as e}
		{@const p = placeEvent(e, range, day)}
		{#if p}
			<button type="button" on:click={() => dispatch('select', e)}
				class="absolute left-14 right-3 rounded-lg px-2 py-1 text-left text-white text-xs shadow-sm overflow-hidden hover:brightness-110"
				style="top:{p.top}%; height:{p.height}%; background:{SOURCE_META[e.source].color}">
				<span class="font-medium truncate block">{e.title}</span>
				<span class="opacity-80">{hhmm(e.startAt)}–{hhmm(e.endAt || e.startAt)}{#if e.client} · {e.client.name}{/if}</span>
			</button>
		{/if}
	{/each}
</div>
