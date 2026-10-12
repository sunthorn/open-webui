<script lang="ts">
	// Six weeks around the month. Up to three chips a day, then "+N more",
	// which opens that day's whole list. The date number opens Day view.
	import { createEventDispatcher } from 'svelte';
	import type { AgendaEvent } from '$lib/apis/gateway/agenda';
	import { SOURCE_META, localDay } from '$lib/apps/agenda';
	import {
		monthGrid,
		dayEvents,
		eventDays,
		isSpanning,
		parseDay,
		hhmm,
		dayTitle
	} from '$lib/apps/agendaCalendar';

	export let anchor: string;
	export let events: AgendaEvent[] = [];
	export let today: string;
	export let selectedId: string | null = null;
	export let loading = false;

	const dispatch = createEventDispatcher<{ select: AgendaEvent; pickDay: string }>();
	const MAX = 3;
	const heads = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

	$: grid = monthGrid(anchor);
	$: cells = grid.map((c) => {
		const { spanning, timed } = dayEvents(events, c.day);
		return { ...c, list: [...spanning, ...timed] };
	});
	$: rows = Array.from({ length: 6 }, (_, r) => cells.slice(r * 7, r * 7 + 7));
	$: empty = !loading && cells.every((c) => !c.inMonth || c.list.length === 0);

	let open: string | null = null; // the day whose "+N more" list is showing
	const onWindowClick = (e: MouseEvent) => {
		if (open && !(e.target as HTMLElement)?.closest?.('[data-month-popover]')) open = null;
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === 'Escape' && open) {
			e.stopPropagation();
			open = null;
		}
	};
	const choose = (e: AgendaEvent) => {
		open = null;
		dispatch('select', e);
	};
</script>

<svelte:window on:click={onWindowClick} on:keydown={onKey} />

<div
	class="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900"
	role="grid"
	aria-label="Month"
>
	<div class="grid grid-cols-7 border-b border-gray-100 dark:border-gray-800" role="row">
		{#each heads as h}
			<div
				class="py-1.5 text-center text-[11px] uppercase tracking-wide text-gray-500"
				role="columnheader"
			>
				<span class="hidden sm:inline">{h}</span><span class="sm:hidden">{h[0]}</span>
			</div>
		{/each}
	</div>
	{#each rows as row, r}
		<div
			class="grid grid-cols-7 {r < 5 ? 'border-b border-gray-100 dark:border-gray-800' : ''}"
			role="row"
		>
			{#each row as c, i (c.day)}
				<div
					class="relative min-h-[5.5rem] sm:min-h-[6.5rem] py-1 {i > 0
						? 'border-l border-gray-100 dark:border-gray-800'
						: ''} {c.inMonth ? '' : 'bg-gray-50/60 dark:bg-gray-850/40'} {r === 5 && i === 0
						? 'rounded-bl-2xl'
						: ''} {r === 5 && i === 6 ? 'rounded-br-2xl' : ''}"
					role="gridcell"
					aria-label="{dayTitle(c.day)}, {c.list.length} {c.list.length === 1 ? 'event' : 'events'}"
				>
					<div class="flex justify-center sm:justify-start mb-0.5 px-1">
						<button
							type="button"
							class="min-w-6 h-6 px-1 rounded-full text-xs tabular-nums transition
								{c.day === today
								? 'bg-red-600 text-white font-semibold'
								: c.inMonth
									? 'text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
									: 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}"
							aria-label="Open {dayTitle(c.day)} in Day view"
							on:click={() => dispatch('pickDay', c.day)}
							>{parseDay(c.day).getDate() === 1 && !c.inMonth
								? parseDay(c.day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
								: parseDay(c.day).getDate()}</button
						>
					</div>
					<div class="space-y-0.5">
						{#each c.list.slice(0, MAX) as e (e.id)}
							{@const solid = isSpanning(e)}
							{@const span = eventDays(e)}
							{@const joinL = solid && span.first < c.day && i > 0}
							{@const joinR = solid && span.last > c.day && i < 6}
							<div class="{joinL ? '' : 'pl-1'} {joinR ? '' : 'pr-1'}">
								<button
									type="button"
									class="w-full min-w-0 flex items-center gap-1 px-1 h-[18px] text-[11px] leading-none text-left overflow-hidden
									{solid ? 'text-white hover:brightness-110' : 'rounded hover:bg-gray-100 dark:hover:bg-gray-800'}
									{joinL ? 'rounded-l-none' : 'rounded-l'} {joinR ? 'rounded-r-none' : 'rounded-r'}
									{selectedId === e.id ? 'ring-2 ring-gray-900 dark:ring-white' : ''}"
									style={solid ? `background:${SOURCE_META[e.source].color}` : ''}
									title="{e.title}{e.client ? ` · ${e.client.name}` : ''}"
									aria-label="{e.title}, {solid ? 'all day' : hhmm(e.startAt)}{e.client
										? `, ${e.client.name}`
										: ''}"
									on:click={() => dispatch('select', e)}
								>
									{#if !solid}
										<span
											class="size-1.5 shrink-0 rounded-full"
											style="background:{SOURCE_META[e.source].color}"
										></span>
										<span class="hidden sm:inline shrink-0 text-gray-500 tabular-nums"
											>{localDay(e.startAt) < c.day ? '…' : hhmm(e.startAt)}</span
										>
									{/if}
									<span class="min-w-0 truncate {solid ? '' : 'text-gray-800 dark:text-gray-200'}"
										>{#if joinL}<span class="opacity-70">{'‹ '}</span>{/if}{e.title}</span
									>
								</button>
							</div>
						{/each}
						{#if c.list.length > MAX}
							<button
								type="button"
								data-month-popover
								class="w-full text-left px-2 text-[11px] whitespace-nowrap font-medium text-gray-500 hover:text-gray-900 dark:hover:text-white"
								aria-haspopup="dialog"
								aria-expanded={open === c.day}
								on:click|stopPropagation={() => (open = open === c.day ? null : c.day)}
								>+{c.list.length - MAX}<span class="hidden sm:inline">{' more'}</span></button
							>
						{/if}
					</div>

					{#if open === c.day}
						<div
							data-month-popover
							class="absolute z-40 {r >= 3 ? 'bottom-0' : 'top-0'} {i >= 4
								? 'right-0'
								: 'left-0'} w-60 max-h-72 overflow-auto rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-850 shadow-xl p-2"
							role="dialog"
							aria-label="Events on {dayTitle(c.day)}"
						>
							<div class="flex items-center justify-between mb-1.5 px-1">
								<button
									type="button"
									class="text-xs font-medium hover:underline"
									on:click={() => dispatch('pickDay', c.day)}>{dayTitle(c.day)}</button
								>
								<button
									type="button"
									class="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xs px-1"
									aria-label="Close"
									on:click={() => (open = null)}>✕</button
								>
							</div>
							<ul class="space-y-0.5">
								{#each c.list as e (e.id)}
									<li>
										<button
											type="button"
											class="w-full flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-left hover:bg-gray-100 dark:hover:bg-gray-800
												{selectedId === e.id ? 'bg-gray-100 dark:bg-gray-800' : ''}"
											on:click={() => choose(e)}
										>
											<span
												class="size-2 shrink-0 rounded-full"
												style="background:{SOURCE_META[e.source].color}"
											></span>
											<span class="shrink-0 w-11 text-gray-500 tabular-nums"
												>{e.allDay ? 'all day' : hhmm(e.startAt)}</span
											>
											<span class="truncate">{e.title}</span>
										</button>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/each}
</div>
{#if empty}
	<p class="mt-2 text-center text-sm text-gray-400">Nothing scheduled this month.</p>
{/if}
