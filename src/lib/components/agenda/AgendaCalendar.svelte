<script lang="ts">
	// Briefing's calendar: Day, Work week, Week, Month and Agenda over every
	// source the agenda merges. It fetches whatever range it shows (GET
	// /gw/agenda, ≤31 days per call — Month's six weeks take two), except when
	// that range sits inside the page's own today..today+7 read, which it
	// reuses. Drag to move / resize only reports intent (`move`); the page
	// confirms, calls the API and bumps `refreshKey`, and this re-reads.
	// Date and layout maths: $lib/apps/agendaCalendar.ts (unit-tested).
	import { createEventDispatcher, onDestroy, onMount } from 'svelte';
	import { getAgenda, type AgendaEvent, type AgendaSource } from '$lib/apis/gateway/agenda';
	import { SOURCE_META, weekScrollHour } from '$lib/apps/agenda';
	import {
		CAL_VIEWS,
		VIEW_LABEL,
		addDays,
		chunkRange,
		coversDay,
		mergeEvents,
		rangeInside,
		stepAnchor,
		viewRange,
		viewTitle,
		type CalView
	} from '$lib/apps/agendaCalendar';
	import TimeGrid from './calendar/TimeGrid.svelte';
	import MonthGrid from './calendar/MonthGrid.svelte';
	import AgendaList from './calendar/AgendaList.svelte';
	import MiniMonth from './calendar/MiniMonth.svelte';

	export let token: string;
	/** YYYY-MM-DD, local. */
	export let today: string;
	/** The page's already-loaded today..today+7 events. */
	export let todayEvents: AgendaEvent[] = [];
	/** Bumped by the page after a write or a Refresh: re-read with refresh=true. */
	export let refreshKey = 0;
	export let selectedId: string | null = null;

	const dispatch = createEventDispatcher<{
		select: AgendaEvent;
		move: { event: AgendaEvent; startAt: string; endAt: string };
	}>();

	const VIEW_KEY = 'axi.briefing.calendar.view';
	const HIDDEN_KEY = 'axi.briefing.calendar.hiddenSources';
	const SOURCES: AgendaSource[] = ['m365', 'google', 'xplan'];
	const VIEW_KEYS: Record<string, CalView> = { d: 'day', w: 'week', m: 'month', a: 'agenda' };

	let view: CalView = 'week';
	let anchor = today;
	let hidden = new Set<AgendaSource>();
	let now = new Date();
	let mounted = false;

	// --- remembered choices (per browser; storage may be unavailable) ---------------
	const store = (k: string, v: string) => {
		try {
			localStorage.setItem(k, v);
		} catch {
			/* private window or blocked storage: the choice just isn't remembered */
		}
	};
	const recall = (k: string): string | null => {
		try {
			return localStorage.getItem(k);
		} catch {
			return null;
		}
	};

	const setView = (v: CalView) => {
		view = v;
		store(VIEW_KEY, v);
	};
	const toggleSource = (s: AgendaSource) => {
		hidden.has(s) ? hidden.delete(s) : hidden.add(s);
		hidden = new Set(hidden);
		store(HIDDEN_KEY, JSON.stringify([...hidden]));
	};

	// --- the range shown, and its events ------------------------------------------------
	$: range = viewRange(view, anchor);
	$: key = `${range.from}|${range.to}`;
	$: fromPage = rangeInside(range.from, range.to, today, addDays(today, 7));
	$: title = viewTitle(view, anchor);
	$: showsToday = range.days.includes(today);

	let fetched: AgendaEvent[] = [];
	let fetchedKey = '';
	let loading = false;
	let error = '';
	let seq = 0;
	const cache = new Map<string, AgendaEvent[]>();

	const load = async (refresh = false) => {
		const mine = ++seq; // a newer range's answer wins over a slower, older one
		const { from, to } = range;
		const k = key;
		loading = true;
		error = '';
		try {
			const parts = await Promise.all(
				chunkRange(from, to).map((c) => getAgenda(token, c.from, c.to, refresh))
			);
			const events = mergeEvents(parts.map((p) => p.events));
			cache.set(k, events);
			if (mine === seq) {
				fetched = events;
				fetchedKey = k;
			}
		} catch (e: any) {
			if (mine === seq) error = e?.message ?? 'Could not load the calendar';
		} finally {
			if (mine === seq) loading = false;
		}
	};

	const onRange = (k: string, usePage: boolean) => {
		if (usePage) {
			seq++; // drop any answer still on its way for another range
			loading = false;
			error = '';
			return;
		}
		const hit = cache.get(k);
		if (hit) {
			seq++;
			fetched = hit;
			fetchedKey = k;
			loading = false;
			error = '';
		} else void load(false);
	};
	$: if (mounted) onRange(key, fromPage);

	let seenRefresh = refreshKey;
	const onRefresh = (rk: number) => {
		if (rk === seenRefresh) return;
		seenRefresh = rk;
		cache.clear();
		// Inside the page's window, the page's own reload brings the new events.
		if (mounted && !fromPage) void load(true);
	};
	$: onRefresh(refreshKey);

	// While another range loads, the last one stays drawn (only its days that are
	// still in view show) rather than flashing empty.
	$: base = fromPage ? todayEvents : fetched;
	$: events = base.filter((e) => !hidden.has(e.source));
	$: inRange = events.filter((e) => range.days.some((d) => coversDay(e, d)));
	$: ready = fromPage || fetchedKey === key;
	$: scrollHour = weekScrollHour(inRange);
	$: scrollKey = `${view}|${key}|${ready ? 'ready' : ''}`;
	$: counts = Object.fromEntries(
		SOURCES.map((s) => [
			s,
			base.filter((e) => e.source === s && range.days.some((d) => coversDay(e, d))).length
		])
	) as Record<AgendaSource, number>;

	// --- navigation ---------------------------------------------------------------------------
	const step = (dir: number) => (anchor = stepAnchor(view, anchor, dir));
	const goToday = () => (anchor = today);
	const goDay = (d: string) => {
		anchor = d;
		setView('day');
	};

	let pickerOpen = false;
	const pickDate = (d: string) => {
		anchor = d;
		pickerOpen = false;
	};

	const typing = (t: EventTarget | null) => {
		const el = t as HTMLElement | null;
		if (!el) return false;
		return (
			el.isContentEditable ||
			['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ||
			!!el.closest?.('[contenteditable="true"]')
		);
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
		if (e.key === 'Escape' && pickerOpen) {
			pickerOpen = false;
			return;
		}
		const k = e.key.toLowerCase();
		if (k === 't') goToday();
		else if (e.key === 'ArrowLeft') step(-1);
		else if (e.key === 'ArrowRight') step(1);
		else if (VIEW_KEYS[k]) setView(VIEW_KEYS[k]);
		else return;
		e.preventDefault();
	};
	const onWindowClick = (e: MouseEvent) => {
		if (pickerOpen && !(e.target as HTMLElement)?.closest?.('[data-date-picker]'))
			pickerOpen = false;
	};

	let timer: ReturnType<typeof setInterval> | undefined;
	onMount(() => {
		const saved = recall(VIEW_KEY) as CalView | null;
		const phone = window.matchMedia?.('(max-width: 639px)').matches ?? false;
		if (saved && CAL_VIEWS.includes(saved)) view = saved;
		else view = phone ? 'day' : 'week';
		// Seven columns don't fit a phone: show the day instead (the choice stays saved).
		if (phone && (view === 'week' || view === 'workweek')) view = 'day';
		try {
			const h = JSON.parse(recall(HIDDEN_KEY) ?? '[]');
			if (Array.isArray(h)) hidden = new Set(h.filter((s) => SOURCES.includes(s)));
		} catch {
			/* a bad saved value: show every source */
		}
		// The now-line moves each minute, on the minute.
		const tickNow = () => (now = new Date());
		const first = setTimeout(
			() => {
				tickNow();
				timer = setInterval(tickNow, 60_000);
			},
			60_000 - (Date.now() % 60_000)
		);
		mounted = true;
		return () => clearTimeout(first);
	});
	onDestroy(() => clearInterval(timer));

	const forwardSelect = (e: CustomEvent<AgendaEvent>) => dispatch('select', e.detail);
	const forwardMove = (e: CustomEvent<{ event: AgendaEvent; startAt: string; endAt: string }>) =>
		dispatch('move', e.detail);
</script>

<svelte:window on:keydown={onKey} on:click={onWindowClick} />

<div class="min-w-0">
	<!-- Toolbar -->
	<div class="flex flex-wrap items-center gap-x-2 gap-y-2 mb-2">
		<button
			type="button"
			class="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
			title="Go to today (T)"
			aria-current={showsToday ? 'date' : undefined}
			on:click={goToday}>Today</button
		>
		<div class="flex items-center">
			<button
				type="button"
				class="size-8 rounded-lg text-lg leading-none hover:bg-gray-100 dark:hover:bg-gray-800"
				aria-label="Previous {VIEW_LABEL[view].toLowerCase()} (←)"
				title="Previous (←)"
				on:click={() => step(-1)}>‹</button
			>
			<button
				type="button"
				class="size-8 rounded-lg text-lg leading-none hover:bg-gray-100 dark:hover:bg-gray-800"
				aria-label="Next {VIEW_LABEL[view].toLowerCase()} (→)"
				title="Next (→)"
				on:click={() => step(1)}>›</button
			>
		</div>
		<div class="relative" data-date-picker>
			<button
				type="button"
				class="flex items-center gap-1 text-sm sm:text-base font-semibold tracking-tight px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
				aria-haspopup="dialog"
				aria-expanded={pickerOpen}
				aria-label="{title} — pick a date"
				on:click={() => (pickerOpen = !pickerOpen)}
			>
				{title}
				<svg
					class="size-3.5 text-gray-400 transition {pickerOpen ? 'rotate-180' : ''}"
					viewBox="0 0 20 20"
					fill="currentColor"
					aria-hidden="true"
					><path
						fill-rule="evenodd"
						d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
						clip-rule="evenodd"
					/></svg
				>
			</button>
			{#if pickerOpen}
				<div
					class="absolute z-50 left-0 mt-1 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-850 shadow-xl"
					role="dialog"
					aria-label="Jump to a date"
				>
					<MiniMonth
						value={anchor}
						{today}
						from={range.from}
						to={range.to}
						on:pick={(e) => pickDate(e.detail)}
					/>
				</div>
			{/if}
		</div>
		{#if loading}
			<span class="flex items-center gap-1.5 text-xs text-gray-400" role="status">
				<span
					class="size-3 rounded-full border-2 border-gray-300 border-t-transparent dark:border-gray-600 dark:border-t-transparent animate-spin"
				></span>
				loading…
			</span>
		{/if}

		<div
			class="ml-auto flex text-xs rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
			role="tablist"
			aria-label="Calendar view"
		>
			{#each CAL_VIEWS as v}
				<button
					type="button"
					role="tab"
					aria-selected={view === v}
					title="{VIEW_LABEL[v]}{v === 'workweek' ? '' : ` (${v[0].toUpperCase()})`}"
					class="px-2.5 sm:px-3 py-1.5 border-l first:border-l-0 border-gray-200 dark:border-gray-700 transition
						{v === 'week' || v === 'workweek' ? 'hidden sm:block' : ''}
						{view === v
						? 'bg-gray-100 dark:bg-gray-800 font-medium text-gray-900 dark:text-white'
						: 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-850'}"
					on:click={() => setView(v)}>{VIEW_LABEL[v]}</button
				>
			{/each}
		</div>
	</div>

	<!-- Source filter: the legend doubles as show/hide -->
	<div class="flex flex-wrap items-center gap-1.5 mb-2" role="group" aria-label="Show calendars">
		{#each SOURCES as s}
			{@const off = hidden.has(s)}
			<button
				type="button"
				aria-pressed={!off}
				title="{off ? 'Show' : 'Hide'} {SOURCE_META[s].label} events"
				class="flex items-center gap-1.5 text-[11px] pl-1.5 pr-2 py-0.5 rounded-full border transition
					{off
					? 'border-gray-200 dark:border-gray-700 text-gray-400 line-through'
					: 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-850'}"
				on:click={() => toggleSource(s)}
			>
				<span
					class="size-2.5 rounded-full border-2"
					style="border-color:{SOURCE_META[s].color};background:{off
						? 'transparent'
						: SOURCE_META[s].color}"
				></span>
				{SOURCE_META[s].label}
				{#if ready && counts[s]}<span class="text-gray-400 tabular-nums">{counts[s]}</span>{/if}
			</button>
		{/each}
		<span class="ml-auto hidden md:inline text-[11px] text-gray-400">
			Drag a writable event to move it · T today · ← → step · D W M A views
		</span>
	</div>

	{#if error}
		<div
			class="mb-2 flex flex-wrap items-center gap-2 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900 rounded-xl px-3 py-2"
			role="alert"
		>
			<span>Couldn't load this {view === 'month' ? 'month' : 'range'}: {error}</span>
			<button type="button" class="underline font-medium" on:click={() => load(false)}
				>Try again</button
			>
		</div>
	{/if}

	{#if view === 'month'}
		<MonthGrid
			{anchor}
			{events}
			{today}
			{selectedId}
			loading={loading || !ready}
			on:select={forwardSelect}
			on:pickDay={(e) => goDay(e.detail)}
		/>
	{:else if view === 'agenda'}
		<AgendaList
			days={range.days}
			{events}
			{today}
			{now}
			{selectedId}
			loading={loading || !ready}
			on:select={forwardSelect}
			on:pickDay={(e) => goDay(e.detail)}
		/>
	{:else}
		<TimeGrid
			days={range.days}
			{events}
			{today}
			{now}
			{selectedId}
			{scrollHour}
			{scrollKey}
			loading={loading || !ready}
			on:select={forwardSelect}
			on:move={forwardMove}
			on:pickDay={(e) => goDay(e.detail)}
		/>
	{/if}
</div>
