<script lang="ts">
	// Book discovery meeting — the planner's week (the Briefing week view) to
	// pick one hour on. An hour that has passed, or that the loaded agenda
	// shows as busy, cannot be sent; the page queues onb_book and owns the
	// job's outcome (`sending`, `error`).
	import { createEventDispatcher } from 'svelte';
	import { getAgenda, isoDate, type AgendaResponse } from '$lib/apis/gateway/agenda';
	import {
		sourceCalendars,
		toCalendarEvents,
		weekStartOf,
		shiftWeek,
		weekWindow,
		weekLabel,
		weekScrollHour
	} from '$lib/apps/agenda';
	import {
		calendarLinksFor,
		hourBlock,
		hourRangeLabel,
		isSlotBusy,
		type HourBlock
	} from '$lib/apps/onboarding';
	import CalendarView from '$lib/components/calendar/CalendarView.svelte';

	/** The row already has an invite out: this is a second one. */
	export let needsAgain = false;
	/** Shown under the picked hour when `needsAgain`. */
	export let againWarning = '';
	/** Where the invite goes (the client's email on file). */
	export let email: string | null = null;
	/** The booking is queued or running. */
	export let sending = false;
	/** The gateway's or the job's refusal, in planner words. */
	export let error = '';

	const dispatch = createEventDispatcher<{ send: { hour: Date }; pick: null; close: null }>();
	const token = () => localStorage.getItem('token') ?? '';
	const calendars = sourceCalendars();
	const visible = new Set(calendars.map((c) => c.id));

	let weekStart = weekStartOf(new Date());
	let agenda: AgendaResponse | null = null;
	let loading = false;
	let loadError = '';
	let seq = 0;
	const loadWeek = async (refresh = false) => {
		const mine = ++seq; // a newer week's answer wins over a slower, older one
		loading = true;
		loadError = '';
		const { from, to } = weekWindow(weekStart);
		try {
			const a = await getAgenda(token(), from, to, refresh);
			if (mine === seq) agenda = a;
		} catch (e: any) {
			if (mine === seq) loadError = e?.message ?? 'Could not load this week';
		} finally {
			if (mine === seq) loading = false;
		}
	};
	const goWeek = (weeks: number | null) => {
		weekStart = weeks === null ? weekStartOf(new Date()) : shiftWeek(weekStart, weeks);
		agenda = null;
		void loadWeek();
	};
	void loadWeek();

	let picked: Date | null = null;
	const pick = (hour: Date) => {
		if (sending) return;
		picked = hour;
		dispatch('pick', null);
	};
	const pickAt = (ns: number) => {
		const d = new Date(ns / 1_000_000);
		pick(new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()));
	};
	// Re-checked when the week (re)loads, e.g. after Refresh.
	let block: HourBlock | null = null;
	$: block = picked ? hourBlock(picked, agenda?.events ?? [], new Date()) : null;

	$: events = agenda ? toCalendarEvents(agenda.events) : [];
	$: scrollHour = weekScrollHour(agenda?.events ?? []);
	$: thisWeek = isoDate(weekStart) === isoDate(weekStartOf(new Date()));
	$: busyLinks = block?.kind === 'busy' ? calendarLinksFor(block.events.map((e) => e.source)) : [];
	$: serverBusy = isSlotBusy(error);
	$: canSend = !!picked && !block && !!agenda && !sending;
</script>

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
	role="dialog"
	aria-modal="true"
>
	<div
		class="w-full max-w-5xl max-h-[95vh] flex flex-col rounded-2xl bg-white dark:bg-gray-900 shadow-xl p-5"
	>
		<div class="flex flex-wrap items-start justify-between gap-2">
			<div>
				<p class="text-xs font-semibold text-gray-400 uppercase tracking-wide">
					Book discovery meeting
				</p>
				<p class="text-sm mt-1 text-gray-500">
					Click a free hour. The invite goes to the client from your calendar.
				</p>
			</div>
			<button
				on:click={() => dispatch('close', null)}
				aria-label="Close"
				class="text-sm px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-850 disabled:opacity-40"
				>✕</button
			>
		</div>

		<div class="flex flex-wrap items-center gap-2 mt-3 mb-2 text-sm">
			<button
				class="px-2 py-0.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
				aria-label="Previous week"
				on:click={() => goWeek(-1)}>‹</button
			>
			<button
				class="px-2 py-0.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
				aria-label="Next week"
				on:click={() => goWeek(1)}>›</button
			>
			<span class="font-medium">{weekLabel(weekStart)}</span>
			{#if !thisWeek}
				<button
					class="text-xs px-2 py-0.5 rounded-md border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
					on:click={() => goWeek(null)}>This week</button
				>
			{/if}
			{#if loading}<span class="text-xs text-gray-400">loading…</span>{/if}
			{#if loadError}
				<span class="text-xs text-red-500"
					>{loadError} —
					<button class="underline" on:click={() => loadWeek()}>try again</button></span
				>
			{/if}
			<button
				class="ml-auto text-xs px-2 py-0.5 rounded-md border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
				title="Ask Outlook and Google again — after freeing an hour there"
				disabled={loading}
				on:click={() => loadWeek(true)}>Refresh</button
			>
		</div>
		<!-- CalendarView's week grid fills its parent: the parent needs a height. -->
		<div
			class="h-[min(36rem,60vh)] shrink-0 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden"
		>
			<CalendarView
				{events}
				{calendars}
				visibleCalendarIds={visible}
				view="week"
				currentDate={weekStart}
				scrollToHour={scrollHour}
				pickedHour={picked ? picked.getTime() : null}
				on:createEvent={(e) => pickAt(e.detail.start_at)}
				on:eventClick={(e) => pickAt(e.detail.start_at)}
			/>
		</div>

		<div class="mt-3 min-h-[3.5rem]">
			{#if picked}
				<p class="text-sm">
					<span class="font-medium">{hourRangeLabel(picked)}</span>
					<span class="text-gray-500">· invite to {email || '(no email on file)'}</span>
				</p>
				{#if block?.kind === 'busy'}
					<p class="text-xs text-red-600 dark:text-red-400 mt-1">
						That hour is busy — free it in your calendar first.
						{#each busyLinks as l}
							<a href={l.href} target="_blank" rel="noopener noreferrer" class="underline ml-1"
								>{l.label} ↗</a
							>
						{/each}
					</p>
				{:else if block?.kind === 'past'}
					<p class="text-xs text-red-600 dark:text-red-400 mt-1">
						That hour has passed — pick a later one.
					</p>
				{:else if block?.kind === 'too_far'}
					<p class="text-xs text-red-600 dark:text-red-400 mt-1">
						Pick an hour within the next 90 days.
					</p>
				{:else if needsAgain && againWarning}
					<p class="text-xs text-amber-700 dark:text-amber-300 mt-1">{againWarning}</p>
				{/if}
			{:else}
				<p class="text-sm text-gray-500">No hour picked yet.</p>
			{/if}
			{#if error}
				<p class="text-xs text-red-600 dark:text-red-400 mt-1">
					{error}
					{#if serverBusy}
						{#each calendarLinksFor([]) as l}
							<a href={l.href} target="_blank" rel="noopener noreferrer" class="underline ml-1"
								>{l.label} ↗</a
							>
						{/each}
					{/if}
				</p>
			{/if}
		</div>

		<div class="flex justify-end gap-2 mt-3">
			<button
				on:click={() => dispatch('close', null)}
				class="text-sm px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-850 transition"
				>Cancel</button
			>
			<button
				on:click={() => picked && dispatch('send', { hour: picked })}
				disabled={!canSend}
				class="text-sm px-4 py-2 rounded-xl bg-black text-white dark:bg-white dark:text-black hover:opacity-90 disabled:opacity-40 transition"
				>{sending ? 'Sending…' : needsAgain ? 'Send again' : 'Send invite'}</button
			>
		</div>
	</div>
</div>
