<script lang="ts">
	// The Agenda view: the coming days as a list, days with nothing on them
	// left out (today is always shown so the planner knows where they are).
	import { createEventDispatcher } from 'svelte';
	import type { AgendaEvent } from '$lib/apis/gateway/agenda';
	import { SOURCE_META } from '$lib/apps/agenda';
	import {
		dayEvents,
		parseDay,
		hhmm,
		weekdayShort,
		monthShort,
		isSpanning
	} from '$lib/apps/agendaCalendar';

	export let days: string[];
	export let events: AgendaEvent[] = [];
	export let today: string;
	export let now: Date;
	export let selectedId: string | null = null;
	export let loading = false;

	const dispatch = createEventDispatcher<{ select: AgendaEvent; pickDay: string }>();

	$: rows = days
		.map((day) => {
			const { spanning, timed } = dayEvents(events, day);
			return { day, list: [...spanning, ...timed] };
		})
		.filter((r) => r.list.length || r.day === today);
	$: empty = !loading && rows.every((r) => r.list.length === 0);

	const when = (e: AgendaEvent, day: string) => {
		if (isSpanning(e)) return 'All day';
		const s = new Date(e.startAt);
		const en = new Date(e.endAt || e.startAt);
		const sDay = parseDay(day).getTime();
		const from = s.getTime() < sDay ? '…' : hhmm(s);
		return `${from} – ${hhmm(en)}`;
	};
	const live = (e: AgendaEvent) =>
		!isSpanning(e) &&
		Date.parse(e.startAt) <= now.getTime() &&
		now.getTime() < Date.parse(e.endAt || e.startAt);
	const past = (e: AgendaEvent) =>
		!isSpanning(e) && Date.parse(e.endAt || e.startAt) < now.getTime();
</script>

<div
	class="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 max-h-[min(40rem,70vh)] overflow-auto"
>
	{#if empty}
		<p class="py-16 text-center text-sm text-gray-400">
			Nothing scheduled in these {days.length} days.
		</p>
	{:else}
		<ol class="divide-y divide-gray-100 dark:divide-gray-800">
			{#each rows as r (r.day)}
				<li class="flex gap-3 sm:gap-5 px-3 sm:px-4 py-3">
					<button
						type="button"
						class="w-12 shrink-0 text-left group"
						aria-label="Open {parseDay(r.day).toDateString()} in Day view"
						on:click={() => dispatch('pickDay', r.day)}
					>
						<span
							class="block text-[11px] uppercase tracking-wide {r.day === today
								? 'text-red-600 dark:text-red-400 font-semibold'
								: 'text-gray-500'}">{weekdayShort(r.day)}</span
						>
						<span
							class="inline-flex items-center justify-center min-w-8 h-8 -ml-1 px-1 rounded-full text-lg tabular-nums group-hover:bg-gray-100 dark:group-hover:bg-gray-800
								{r.day === today ? 'bg-red-600 text-white group-hover:bg-red-700 dark:group-hover:bg-red-700' : ''}"
							>{parseDay(r.day).getDate()}</span
						>
						<span class="block text-[10px] text-gray-400">{monthShort(r.day)}</span>
					</button>
					<ul class="flex-1 min-w-0 space-y-1 pt-0.5">
						{#each r.list as e (e.id)}
							<li>
								<button
									type="button"
									class="w-full flex items-start gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-gray-50 dark:hover:bg-gray-850
										{selectedId === e.id ? 'bg-gray-100 dark:bg-gray-850 ring-1 ring-gray-200 dark:ring-gray-700' : ''}
										{past(e) ? 'opacity-60' : ''}"
									on:click={() => dispatch('select', e)}
								>
									<span
										class="mt-1 w-1 self-stretch shrink-0 rounded-full"
										style="background:{SOURCE_META[e.source].color}"
									></span>
									<span class="w-24 shrink-0 text-xs text-gray-500 tabular-nums pt-0.5">
										{when(e, r.day)}
										{#if live(e)}<span
												class="block text-[10px] font-semibold text-red-600 dark:text-red-400"
												>now</span
											>{/if}
									</span>
									<span class="min-w-0 flex-1">
										<span class="block truncate font-medium">{e.title}</span>
										<span class="block truncate text-xs text-gray-500">
											{[SOURCE_META[e.source].label, e.client?.name, e.location]
												.filter(Boolean)
												.join(' · ')}
										</span>
									</span>
								</button>
							</li>
						{:else}
							<li class="px-2 py-1.5 text-sm text-gray-400">Nothing scheduled today</li>
						{/each}
					</ul>
				</li>
			{/each}
		</ol>
	{/if}
</div>
