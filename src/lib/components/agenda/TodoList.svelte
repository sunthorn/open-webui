<script lang="ts">
	// The Briefing page's task list: quick counts, search and filters, groups
	// by due date / client / source, and one row per task. The page owns the
	// confirm dialog and every write; this component only says what the
	// planner asked for (spec §10 item 4).
	import type { AgendaSource, AgendaTask } from '$lib/apis/gateway/agenda';
	import { SOURCE_META } from '$lib/apps/agenda';
	import {
		GROUP_BY_OPTIONS,
		SORT_OPTIONS,
		DEFAULT_FILTERS,
		TODO_PREFS_KEY,
		completeBlock,
		filterTasks,
		filtersActive,
		groupTodos,
		openBlocked,
		parsePrefs,
		stepFocus,
		todoCounts,
		type QuickFilter,
		type SnoozeChoice,
		type TodoFilters,
		type TodoGroupBy,
		type TodoSort
	} from '$lib/apps/agendaTodo';
	import { createEventDispatcher, onMount, tick } from 'svelte';
	import TodoRow from './todo/TodoRow.svelte';
	import Search from '$lib/components/icons/Search.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';
	import ChevronRight from '$lib/components/icons/ChevronRight.svelte';

	export let tasks: AgendaTask[] = [];
	export let today: string;
	export let xplanLocked = false;
	export let busyId: string | null = null;

	const dispatch = createEventDispatcher<{
		open: AgendaTask;
		complete: AgendaTask;
		snooze: { task: AgendaTask; choice: SnoozeChoice };
		accept: AgendaTask;
		reject: AgendaTask;
		assign: AgendaTask;
		unpin: AgendaTask;
	}>();

	// --- view state ------------------------------------------------------------
	let groupBy: TodoGroupBy = 'due';
	let sort: TodoSort = 'due';
	let collapsed: Record<string, boolean> = {};
	let filters: TodoFilters = { ...DEFAULT_FILTERS, hiddenSources: [] };
	let loaded = false;

	let menuFor: string | null = null;
	let focusId: string | null = null;
	let expanded: Record<string, boolean> = {};

	let root: HTMLElement;
	let searchEl: HTMLInputElement;

	onMount(() => {
		let raw: string | null = null;
		try {
			raw = localStorage.getItem(TODO_PREFS_KEY);
		} catch {
			// private window / blocked storage: defaults it is
		}
		const p = parsePrefs(raw);
		groupBy = p.groupBy;
		sort = p.sort;
		collapsed = p.collapsed;
		filters = { ...filters, showCompleted: p.showCompleted };
		loaded = true;
	});

	$: if (loaded) save(groupBy, sort, filters.showCompleted, collapsed);
	const save = (
		g: TodoGroupBy,
		s: TodoSort,
		showCompleted: boolean,
		c: Record<string, boolean>
	) => {
		try {
			const on = Object.fromEntries(Object.entries(c).filter(([, v]) => v));
			localStorage.setItem(
				TODO_PREFS_KEY,
				JSON.stringify({ groupBy: g, sort: s, showCompleted, collapsed: on })
			);
		} catch {
			// best effort
		}
	};

	// --- derived ---------------------------------------------------------------
	$: counts = todoCounts(tasks, today);
	$: presentSources = (Object.keys(SOURCE_META) as AgendaSource[]).filter((s) =>
		tasks.some((t) => t.source === s)
	);
	$: visible = filterTasks(tasks, filters, today);
	$: groups = groupTodos(visible, groupBy, sort, today);
	$: rowIds = groups.flatMap((g) => (collapsed[g.key] ? [] : g.tasks.map((t) => t.id)));
	$: narrowed = filtersActive(filters);
	$: nothingToDo = counts.open === 0 && !(filters.showCompleted && counts.done > 0);
	// The row Tab lands on: the focused one while it is still listed, else the first.
	$: tabId = focusId && rowIds.includes(focusId) ? focusId : (rowIds[0] ?? null);
	$: if (menuFor && !tasks.some((t) => t.id === menuFor)) menuFor = null;

	// --- actions ---------------------------------------------------------------
	const setQuick = (q: QuickFilter) =>
		(filters = { ...filters, quick: filters.quick === q ? null : q });
	const toggleSource = (s: AgendaSource) =>
		(filters = {
			...filters,
			hiddenSources: filters.hiddenSources.includes(s)
				? filters.hiddenSources.filter((x) => x !== s)
				: [...filters.hiddenSources, s]
		});
	const clearFilters = () =>
		(filters = { ...DEFAULT_FILTERS, hiddenSources: [], showCompleted: filters.showCompleted });
	const toggleGroup = (key: string) => (collapsed = { ...collapsed, [key]: !collapsed[key] });
	const toggleExpand = (t: AgendaTask) => (expanded = { ...expanded, [t.id]: !expanded[t.id] });

	const rowEl = (id: string) =>
		root?.querySelector<HTMLElement>(`[data-todo-row="${CSS.escape(id)}"]`) ?? null;
	const focusRow = async (id: string | null) => {
		if (!id) return;
		focusId = id;
		await tick();
		const el = rowEl(id);
		el?.focus();
		el?.scrollIntoView({ block: 'nearest' });
	};

	const complete = (t: AgendaTask) => {
		if (!completeBlock(t, xplanLocked, busyId)) dispatch('complete', t);
	};
	const open = (t: AgendaTask) => {
		if (!openBlocked(t, xplanLocked)) dispatch('open', t);
	};

	const editable = (el: Element | null) =>
		!!el &&
		(el instanceof HTMLInputElement ||
			el instanceof HTMLTextAreaElement ||
			el instanceof HTMLSelectElement ||
			(el as HTMLElement).isContentEditable);

	const onWindowKey = (e: KeyboardEvent) => {
		if (e.key === 'Escape' && menuFor) {
			menuFor = null;
			return;
		}
		if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
		const target = e.target as HTMLElement | null;
		if (editable(target)) return;
		const inside = !!target && !!root?.contains(target);
		const onBody = !target || target === document.body || target === document.documentElement;
		if (!inside && !onBody) return;

		if (e.key === '/') {
			e.preventDefault();
			searchEl?.focus();
			return;
		}
		const down = e.key === 'j' || (inside && e.key === 'ArrowDown');
		const up = e.key === 'k' || (inside && e.key === 'ArrowUp');
		if (down || up) {
			e.preventDefault();
			focusRow(
				stepFocus(rowIds, focusId && rowIds.includes(focusId) ? focusId : null, down ? 1 : -1)
			);
			return;
		}
		// x / space / Enter act on the row itself, never on a button inside it.
		const rowId = target?.dataset?.todoRow;
		const t = rowId ? tasks.find((x) => x.id === rowId) : undefined;
		if (!t) return;
		if (e.key === 'x' || e.key === ' ') {
			e.preventDefault();
			complete(t);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			open(t);
		}
	};

	const onSearchKey = (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			e.preventDefault();
			if (filters.query) filters = { ...filters, query: '' };
			else searchEl.blur();
		} else if (e.key === 'ArrowDown' || (e.key === 'Enter' && rowIds.length)) {
			e.preventDefault();
			focusRow(rowIds[0] ?? null);
		}
	};

	const closeIfOutside = (e: MouseEvent) => {
		if (menuFor && !(e.target as HTMLElement | null)?.closest('[data-todo-menu]')) menuFor = null;
	};

	const quickChips: { key: QuickFilter; label: string; tone: string; active: string }[] = [
		{
			key: 'overdue',
			label: 'Overdue',
			tone: 'text-red-600 dark:text-red-400',
			active: 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900'
		},
		{
			key: 'today',
			label: 'Today',
			tone: 'text-emerald-700 dark:text-emerald-400',
			active: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900'
		},
		{
			key: 'upcoming',
			label: 'Upcoming',
			tone: 'text-gray-700 dark:text-gray-300',
			active: 'bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700'
		}
	];
	const toneClass: Record<string, string> = {
		danger: 'text-red-600 dark:text-red-400',
		accent: 'text-emerald-700 dark:text-emerald-400',
		default: 'text-gray-600 dark:text-gray-300',
		muted: 'text-gray-400 dark:text-gray-500'
	};
</script>

<svelte:window on:keydown={onWindowKey} on:click={closeIfOutside} />

<div bind:this={root} class="space-y-3">
	<!-- Quick counts: each one filters the list -->
	<div class="flex flex-wrap items-center gap-2" role="group" aria-label="Quick filters">
		{#each quickChips as q}
			{@const n = counts[q.key]}
			<button
				type="button"
				class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs transition
					{filters.quick === q.key
					? q.active
					: 'border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-850'}
					{n === 0 && filters.quick !== q.key ? 'opacity-60' : ''}"
				aria-pressed={filters.quick === q.key}
				aria-label="{q.label}: {n} {n === 1 ? 'task' : 'tasks'}{filters.quick === q.key
					? ', filtering'
					: ''}"
				on:click={() => setQuick(q.key)}
			>
				<span class="font-semibold tabular-nums {n ? q.tone : 'text-gray-400'}">{n}</span>
				<span class="text-gray-600 dark:text-gray-300">{q.label}</span>
			</button>
		{/each}
		<span class="ml-auto text-xs text-gray-400 tabular-nums">
			{counts.open} open{#if counts.done}
				· {counts.done} done{/if}
		</span>
	</div>

	<!-- Toolbar -->
	<div class="flex flex-wrap items-center gap-2">
		<label class="relative flex-1 min-w-[12rem]">
			<span class="sr-only">Search tasks</span>
			<span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
				<Search className="size-3.5" />
			</span>
			<input
				bind:this={searchEl}
				type="search"
				placeholder="Search tasks, clients, details"
				class="w-full pl-8 pr-8 py-1.5 text-sm rounded-xl border border-gray-100 dark:border-gray-800 bg-transparent placeholder:text-gray-400 focus:outline-none focus:border-gray-300 dark:focus:border-gray-600"
				value={filters.query}
				on:input={(e) => (filters = { ...filters, query: e.currentTarget.value })}
				on:keydown={onSearchKey}
			/>
			{#if filters.query}
				<button
					type="button"
					class="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
					aria-label="Clear search"
					on:click={() => {
						filters = { ...filters, query: '' };
						searchEl.focus();
					}}
				>
					<XMark className="size-3.5" />
				</button>
			{:else}
				<kbd
					class="hidden sm:block absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] px-1.5 rounded border border-gray-200 dark:border-gray-700 text-gray-400 pointer-events-none"
					aria-hidden="true">/</kbd
				>
			{/if}
		</label>

		{#if presentSources.length > 1 || filters.hiddenSources.length}
			<div class="flex items-center gap-1" role="group" aria-label="Sources">
				{#each presentSources as s}
					{@const on = !filters.hiddenSources.includes(s)}
					<button
						type="button"
						class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs transition
							{on
							? 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200'
							: 'border-gray-100 dark:border-gray-800 text-gray-400 line-through'}"
						aria-pressed={on}
						aria-label="{on ? 'Hide' : 'Show'} {SOURCE_META[s].label} tasks"
						on:click={() => toggleSource(s)}
					>
						<span
							class="size-2 rounded-full {on ? '' : 'opacity-40'}"
							style="background:{SOURCE_META[s].color}"
							aria-hidden="true"
						></span>
						{SOURCE_META[s].label}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
		<div
			class="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
			role="radiogroup"
			aria-label="Group by"
		>
			{#each GROUP_BY_OPTIONS as o}
				<button
					type="button"
					role="radio"
					aria-checked={groupBy === o.value}
					class="px-2.5 py-1 {groupBy === o.value
						? 'bg-gray-100 dark:bg-gray-800 font-medium text-gray-900 dark:text-gray-100'
						: 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-850'}"
					on:click={() => (groupBy = o.value)}
				>
					<span class="sr-only">Group by </span>{o.label}
				</button>
			{/each}
		</div>

		<label class="inline-flex items-center gap-1.5 text-gray-500">
			Sort
			<select
				bind:value={sort}
				class="bg-transparent border border-gray-200 dark:border-gray-700 rounded-lg px-1.5 py-1 text-gray-700 dark:text-gray-200 focus:outline-none"
			>
				{#each SORT_OPTIONS as o}
					<option value={o.value}>{o.label}</option>
				{/each}
			</select>
		</label>

		<label
			class="inline-flex items-center gap-1.5 text-gray-500 cursor-pointer select-none ml-auto"
		>
			<input
				type="checkbox"
				class="rounded accent-gray-700 dark:accent-gray-300"
				checked={filters.showCompleted}
				on:change={(e) => (filters = { ...filters, showCompleted: e.currentTarget.checked })}
			/>
			Show completed
		</label>
	</div>

	<!-- List -->
	{#if nothingToDo && !narrowed}
		<div
			class="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 px-4 py-8 text-center"
		>
			<p class="text-sm text-gray-600 dark:text-gray-300">Nothing to do 🎉</p>
			<p class="text-xs text-gray-400 mt-1">No open tasks from any connected source.</p>
		</div>
	{:else if groups.length === 0}
		<div
			class="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 px-4 py-8 text-center"
		>
			<p class="text-sm text-gray-600 dark:text-gray-300">No tasks match</p>
			{#if narrowed}
				<button
					type="button"
					class="mt-2 text-xs px-3 py-1 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-850"
					on:click={clearFilters}>Clear filters</button
				>
			{/if}
		</div>
	{:else}
		<div class="space-y-3">
			{#each groups as g (g.key)}
				{@const isCollapsed = !!collapsed[g.key]}
				<section
					class="rounded-2xl border border-gray-100 dark:border-gray-800 overflow-visible"
					aria-label={g.label}
				>
					<h3>
						<button
							type="button"
							class="w-full flex items-center gap-2 px-3 sm:px-4 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-850 {isCollapsed
								? 'rounded-2xl'
								: 'rounded-t-2xl'}"
							aria-expanded={!isCollapsed}
							aria-controls="todo-group-{g.key}"
							on:click={() => toggleGroup(g.key)}
						>
							<span class="text-gray-400 transition-transform {isCollapsed ? '' : 'rotate-90'}">
								<ChevronRight className="size-3.5" strokeWidth="2" />
							</span>
							{#if g.color}
								<span class="size-2 rounded-full" style="background:{g.color}" aria-hidden="true"
								></span>
							{/if}
							<span
								class="text-xs font-semibold uppercase tracking-wide truncate {toneClass[g.tone]}"
							>
								{g.label}
							</span>
							<span
								class="text-[11px] tabular-nums px-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500"
								aria-label="{g.openCount} open"
							>
								{g.openCount}
							</span>
							{#if g.doneCount}
								<span class="text-[11px] text-gray-400">· {g.doneCount} done</span>
							{/if}
						</button>
					</h3>
					{#if !isCollapsed}
						<ul
							id="todo-group-{g.key}"
							class="divide-y divide-gray-100 dark:divide-gray-800 border-t border-gray-100 dark:border-gray-800"
						>
							{#each g.tasks as t (t.id)}
								<TodoRow
									task={t}
									{today}
									{xplanLocked}
									busy={busyId === t.id}
									tabbable={tabId === t.id}
									expanded={!!expanded[t.id]}
									menuOpen={menuFor === t.id}
									hideClient={groupBy === 'client'}
									on:focusrow={(e) => (focusId = e.detail.id)}
									on:toggle={(e) => toggleExpand(e.detail)}
									on:menu={(e) => (menuFor = e.detail?.id ?? null)}
									on:complete={(e) => complete(e.detail)}
									on:open={(e) => open(e.detail)}
									on:snooze
									on:accept
									on:reject
									on:assign
									on:unpin
								/>
							{/each}
						</ul>
					{/if}
				</section>
			{/each}
		</div>
		<p class="hidden sm:block text-[11px] text-gray-400">
			<kbd class="font-sans">j</kbd>/<kbd class="font-sans">k</kbd> move ·
			<kbd class="font-sans">x</kbd> done ·
			<kbd class="font-sans">Enter</kbd> open ·
			<kbd class="font-sans">/</kbd> search
		</p>
	{/if}
</div>
