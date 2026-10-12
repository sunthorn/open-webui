<script lang="ts">
	// One task: round checkbox, title, due · client · source, and a ⋯ menu
	// shown on hover/focus (always on touch widths). Clicking the row expands
	// it in place. The list owns focus, expansion and which menu is open; this
	// row only reports what the planner did.
	import type { AgendaTask } from '$lib/apis/gateway/agenda';
	import { SOURCE_META, clientLabel } from '$lib/apps/agenda';
	import {
		SNOOZE_CHOICES,
		completeBlock,
		dueLabel,
		dueTone,
		isDone,
		openBlocked,
		shortDate,
		dueDay,
		type SnoozeChoice
	} from '$lib/apps/agendaTodo';
	import { snoozeUntil } from '$lib/apps/agenda';
	import { createEventDispatcher, tick } from 'svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import Check from '$lib/components/icons/Check.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';
	import Calendar from '$lib/components/icons/Calendar.svelte';
	import EllipsisHorizontal from '$lib/components/icons/EllipsisHorizontal.svelte';
	import ChevronRight from '$lib/components/icons/ChevronRight.svelte';
	import ChevronLeft from '$lib/components/icons/ChevronLeft.svelte';

	export let task: AgendaTask;
	export let today: string;
	export let xplanLocked = false;
	export let busy = false;
	/** Whether this row is the one Tab lands on (roving tabindex). */
	export let tabbable = false;
	export let expanded = false;
	export let menuOpen = false;
	/** Grouped by client: the header already names it. */
	export let hideClient = false;

	const dispatch = createEventDispatcher<{
		open: AgendaTask;
		complete: AgendaTask;
		snooze: { task: AgendaTask; choice: SnoozeChoice };
		accept: AgendaTask;
		reject: AgendaTask;
		assign: AgendaTask;
		unpin: AgendaTask;
		toggle: AgendaTask;
		menu: AgendaTask | null;
		focusrow: AgendaTask;
	}>();

	let menuEl: HTMLElement;
	let triggerEl: HTMLButtonElement;
	let snoozePane = false;

	$: done = isDone(task);
	$: block = completeBlock(task, xplanLocked, busy ? task.id : null);
	$: lockedOpen = openBlocked(task, xplanLocked);
	$: meta = SOURCE_META[task.source];
	$: label = dueLabel(task, today);
	$: tone = dueTone(task, today);
	$: day = dueDay(task);
	$: if (!menuOpen) snoozePane = false;
	$: if (menuOpen) focusMenu();

	const focusMenu = async () => {
		await tick();
		menuEl?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
	};

	const closeMenu = (refocus = true) => {
		dispatch('menu', null);
		if (refocus) triggerEl?.focus();
	};
	const act = (kind: 'open' | 'accept' | 'reject' | 'assign' | 'unpin') => {
		closeMenu(false);
		dispatch(kind, task);
	};
	const snooze = (choice: SnoozeChoice) => {
		closeMenu(false);
		dispatch('snooze', { task, choice });
	};
	const complete = () => {
		if (!block) dispatch('complete', task);
	};

	const rowClick = (e: MouseEvent) => {
		if ((e.target as HTMLElement).closest('button, a, input, [role="menu"]')) return;
		dispatch('toggle', task);
	};

	const menuKey = async (e: KeyboardEvent) => {
		const items = [...menuEl.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')];
		const i = items.indexOf(document.activeElement as HTMLElement);
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			if (snoozePane) {
				snoozePane = false;
				await focusMenu();
			} else closeMenu();
		} else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			e.stopPropagation();
			const next =
				e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
			items[next]?.focus();
		} else if (e.key === 'Tab') {
			closeMenu(false);
		}
		// j/k/x stay inside the menu.
		if (['j', 'k', 'x', ' ', '/'].includes(e.key)) e.stopPropagation();
	};

	const openSnooze = async () => {
		snoozePane = true;
		await focusMenu();
	};
	const backFromSnooze = async () => {
		snoozePane = false;
		await focusMenu();
	};

	const item =
		'w-full flex items-center justify-between gap-3 text-left px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 focus:bg-gray-100 dark:focus:bg-gray-800 focus:outline-none disabled:opacity-40 disabled:hover:bg-transparent';
</script>

<!-- The row is focusable for j/k navigation; its own buttons stay reachable. -->
<!-- svelte-ignore a11y-no-noninteractive-tabindex a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
<li
	data-todo-row={task.id}
	tabindex={tabbable ? 0 : -1}
	aria-label="{task.title}{label ? `, ${label}` : ''}{task.client
		? `, ${task.client.name}`
		: ''}, {meta.label}{done ? ', done' : ''}"
	aria-busy={busy}
	class="group relative px-3 sm:px-4 py-2.5 outline-none cursor-default transition-colors
		hover:bg-gray-50 dark:hover:bg-gray-850/60
		focus-visible:bg-gray-50 dark:focus-visible:bg-gray-850 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/60
		{menuOpen ? 'z-20 bg-gray-50 dark:bg-gray-850/60' : ''}"
	on:focus={() => dispatch('focusrow', task)}
	on:click={rowClick}
>
	<div class="flex items-start gap-3">
		<!-- Checkbox -->
		<button
			type="button"
			class="mt-0.5 shrink-0 size-[18px] rounded-full border flex items-center justify-center transition
				{done
				? 'bg-gray-400 border-gray-400 text-white dark:bg-gray-600 dark:border-gray-600'
				: tone === 'overdue'
					? 'border-red-400 dark:border-red-500/70'
					: 'border-gray-300 dark:border-gray-600'}
				{block ? 'cursor-not-allowed' : 'hover:bg-gray-100 dark:hover:bg-gray-800 group/check'}"
			aria-label={done ? `${task.title} is done` : `Complete ${task.title}`}
			aria-disabled={!!block}
			title={block ?? `Mark done in ${meta.label}`}
			on:click|stopPropagation={complete}
		>
			{#if busy}
				<Spinner className="size-3.5 text-gray-500" />
			{:else if done}
				<Check className="size-3" strokeWidth="3" />
			{:else if !block}
				<Check
					className="size-3 opacity-0 group-hover/check:opacity-60 text-gray-500"
					strokeWidth="2.5"
				/>
			{/if}
		</button>

		<!-- Body -->
		<div class="flex-1 min-w-0">
			<button
				type="button"
				class="block w-full text-left text-sm leading-snug break-words focus:outline-none focus-visible:underline
					{done ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-gray-100'}"
				aria-expanded={expanded}
				aria-controls="todo-detail-{task.id}"
				on:click|stopPropagation={() => dispatch('toggle', task)}
			>
				{task.title}
			</button>

			<div
				class="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs {done
					? 'opacity-60'
					: ''}"
			>
				{#if label}
					<span
						class="inline-flex items-center gap-1 tabular-nums
							{tone === 'overdue'
							? 'text-red-600 dark:text-red-400 font-medium'
							: tone === 'today'
								? 'text-emerald-700 dark:text-emerald-400 font-medium'
								: 'text-gray-500 dark:text-gray-400'}"
					>
						<Calendar className="size-3" />{label}
					</span>
				{/if}

				{#if task.client && !hideClient}
					<span
						class="inline-flex items-center max-w-[14rem] truncate px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
						title="{task.client.name} · {clientLabel(task.client.via)}"
					>
						{task.client.name}
					</span>
				{:else if !task.client && task.suggestion}
					<span
						class="inline-flex items-center gap-1 pl-2 pr-0.5 py-0.5 rounded-full border border-dashed border-amber-400/70 text-amber-800 dark:text-amber-300"
						title="Suggested by the agent"
					>
						<span class="truncate max-w-[10rem]">{task.suggestion.name}?</span>
						<button
							type="button"
							class="rounded-full p-0.5 hover:bg-green-100 dark:hover:bg-green-900/30 text-green-700 dark:text-green-400 disabled:opacity-40"
							disabled={busy}
							aria-label="Yes, {task.suggestion.name} is the client"
							title="Yes, this client"
							on:click|stopPropagation={() => dispatch('accept', task)}
						>
							<Check className="size-3" strokeWidth="2.5" />
						</button>
						<button
							type="button"
							class="rounded-full p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 disabled:opacity-40"
							disabled={busy}
							aria-label="No, not {task.suggestion.name}"
							title="No, not this client"
							on:click|stopPropagation={() => dispatch('reject', task)}
						>
							<XMark className="size-3" strokeWidth="2.5" />
						</button>
					</span>
				{/if}

				<span
					class="inline-flex items-center gap-1 text-gray-400 dark:text-gray-500"
					title={meta.label}
				>
					<span class="size-2 rounded-full" style="background:{meta.color}" aria-hidden="true"
					></span>
					<span class="hidden sm:inline">{meta.label}</span>
					<span class="sr-only sm:hidden">{meta.label}</span>
				</span>

				{#if !expanded && task.detail}
					<span class="hidden md:inline text-gray-400 dark:text-gray-500 truncate max-w-[22rem]"
						>{task.detail}</span
					>
				{/if}
			</div>

			{#if expanded}
				<div
					id="todo-detail-{task.id}"
					class="mt-2 rounded-xl bg-gray-50 dark:bg-gray-850 border border-gray-100 dark:border-gray-800 px-3 py-2 text-xs text-gray-600 dark:text-gray-300 space-y-1.5"
				>
					{#if task.detail}
						<p class="whitespace-pre-wrap break-words text-sm text-gray-700 dark:text-gray-200">
							{task.detail}
						</p>
					{:else}
						<p class="italic text-gray-400">No details from {meta.label}.</p>
					{/if}
					<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-gray-500 dark:text-gray-400">
						<dt>Due</dt>
						<dd>{day ? shortDate(day, today) : 'No date'}</dd>
						<dt>Client</dt>
						<dd>
							{#if task.client}{task.client.name} · {clientLabel(
									task.client.via
								)}{:else if task.suggestion}Suggested: {task.suggestion.name}{:else}Unassigned{/if}
						</dd>
						<dt>Source</dt>
						<dd>{meta.label}{task.writable ? '' : ' · read-only here'}</dd>
					</dl>
					<div class="flex flex-wrap gap-2 pt-1">
						<button
							type="button"
							class="px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-800 disabled:opacity-40"
							disabled={lockedOpen}
							title={lockedOpen ? 'XPLAN access is locked' : meta.openLabel}
							on:click|stopPropagation={() => dispatch('open', task)}>{meta.openLabel} ↗</button
						>
						<button
							type="button"
							class="px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-800 disabled:opacity-40"
							disabled={busy}
							on:click|stopPropagation={() => dispatch('assign', task)}
							>{task.client ? 'Change client…' : 'Assign client…'}</button
						>
					</div>
				</div>
			{/if}
		</div>

		<!-- Actions -->
		<div class="relative shrink-0 flex items-center gap-1" data-todo-menu>
			{#if busy}
				<span class="sr-only">Working…</span>
			{/if}
			<button
				bind:this={triggerEl}
				type="button"
				class="p-1 rounded-lg text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-opacity
					sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 sm:focus:opacity-100
					{menuOpen ? 'sm:opacity-100 bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100' : ''}
					disabled:opacity-40"
				aria-label="Actions for {task.title}"
				aria-haspopup="menu"
				aria-expanded={menuOpen}
				disabled={busy}
				on:click|stopPropagation={() => dispatch('menu', menuOpen ? null : task)}
			>
				<EllipsisHorizontal className="size-4" />
			</button>

			{#if menuOpen}
				<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
				<div
					bind:this={menuEl}
					role="menu"
					tabindex="-1"
					aria-label="Actions for {task.title}"
					class="absolute right-0 top-8 z-30 w-60 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg p-1 text-sm"
					on:keydown={menuKey}
					on:click|stopPropagation
				>
					{#if snoozePane}
						<button
							type="button"
							role="menuitem"
							class="{item} text-gray-500"
							on:click={backFromSnooze}
						>
							<span class="inline-flex items-center gap-1"
								><ChevronLeft className="size-3.5" />Snooze until…</span
							>
						</button>
						<div class="my-1 border-t border-gray-100 dark:border-gray-800"></div>
						{#each SNOOZE_CHOICES as s}
							<button type="button" role="menuitem" class={item} on:click={() => snooze(s.choice)}>
								<span>{s.label}</span>
								<span class="text-xs text-gray-400"
									>{shortDate(snoozeUntil(today, s.choice), today)}</span
								>
							</button>
						{/each}
					{:else}
						<button
							type="button"
							role="menuitem"
							class={item}
							disabled={lockedOpen}
							title={lockedOpen ? 'XPLAN access is locked' : undefined}
							on:click={() => act('open')}
						>
							<span>{meta.openLabel}</span><span class="text-gray-400" aria-hidden="true">↗</span>
						</button>
						{#if task.writable && !done}
							<button
								type="button"
								role="menuitem"
								class={item}
								aria-haspopup="menu"
								on:click={openSnooze}
							>
								<span>Snooze</span><ChevronRight className="size-3.5 text-gray-400" />
							</button>
						{/if}
						<div class="my-1 border-t border-gray-100 dark:border-gray-800"></div>
						{#if !task.client && task.suggestion}
							<button type="button" role="menuitem" class={item} on:click={() => act('accept')}>
								<span class="truncate">Yes, {task.suggestion.name}</span>
								<Check className="size-3.5 text-green-600" strokeWidth="2.5" />
							</button>
							<button type="button" role="menuitem" class={item} on:click={() => act('reject')}>
								<span class="truncate">Not {task.suggestion.name}</span>
								<XMark className="size-3.5 text-gray-400" strokeWidth="2.5" />
							</button>
						{/if}
						<button type="button" role="menuitem" class={item} on:click={() => act('assign')}>
							<span>{task.client ? 'Change client…' : 'Assign client…'}</span>
						</button>
						{#if task.client?.via === 'pin'}
							<button type="button" role="menuitem" class={item} on:click={() => act('unpin')}>
								<span>Clear client</span>
							</button>
						{/if}
					{/if}
				</div>
			{/if}
		</div>
	</div>
</li>
