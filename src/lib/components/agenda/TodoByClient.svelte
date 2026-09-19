<script lang="ts">
	// The accordion: Overdue → clients A–Z → Unassigned. A writable item gets
	// Done (and Snooze under ⋯); everything else keeps the deep-link. The
	// page owns the confirm dialog and the POST — this component only says
	// what the planner clicked (spec §10 item 4).
	import type { AgendaTask } from '$lib/apis/gateway/agenda';
	import { SOURCE_META, groupTasks, clientLabel } from '$lib/apps/agenda';
	import { createEventDispatcher } from 'svelte';

	export let tasks: AgendaTask[] = [];
	export let today: string;
	export let xplanLocked = false;
	export let busyId: string | null = null;

	const dispatch = createEventDispatcher<{
		open: AgendaTask;
		complete: AgendaTask;
		snooze: { task: AgendaTask; choice: 'tomorrow' | 'nextWeek' };
		accept: AgendaTask;
		reject: AgendaTask;
		assign: AgendaTask;
		unpin: AgendaTask;
	}>();
	let collapsed: Record<string, boolean> = {};
	let menuFor: string | null = null;

	$: groups = groupTasks(tasks, today);

	const dueLabel = (t: AgendaTask) => {
		if (!t.dueAt) return '';
		const d = new Date(t.dueAt.length <= 10 ? `${t.dueAt}T00:00:00` : t.dueAt);
		if (t.status === 'overdue') {
			const days = Math.round((Date.parse(`${today}T00:00:00`) - d.getTime()) / 86400000);
			return `${days}d ago`;
		}
		return t.dueAt.slice(0, 10) === today ? 'today' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
	};
	const linkDisabled = (t: AgendaTask) => t.source === 'xplan' && xplanLocked;
	const act = (kind: 'complete' | 'accept' | 'reject' | 'assign' | 'unpin', t: AgendaTask) => {
		menuFor = null;
		dispatch(kind, t);
	};
	const snooze = (t: AgendaTask, choice: 'tomorrow' | 'nextWeek') => {
		menuFor = null;
		dispatch('snooze', { task: t, choice });
	};
	const closeIfOutside = (e: MouseEvent) => {
		if (menuFor && !(e.target as HTMLElement | null)?.closest('[data-todo-menu]')) menuFor = null;
	};
</script>

<svelte:window on:keydown={(e) => e.key === 'Escape' && (menuFor = null)} on:click={closeIfOutside} />

{#if groups.length === 0}
	<p class="text-sm text-gray-500">No open tasks from any connected source.</p>
{/if}
<div class="space-y-3">
	{#each groups as g (g.key)}
		<section class="rounded-2xl border border-gray-100 dark:border-gray-800 overflow-visible">
			<button type="button" on:click={() => (collapsed[g.key] = !collapsed[g.key])}
				class="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-850 rounded-t-2xl">
				<span class="text-xs font-semibold uppercase tracking-wide {g.kind === 'overdue' ? 'text-red-600 dark:text-red-400' : 'text-gray-500'}">
					{#if g.kind === 'overdue'}⚠ {/if}{g.label}
				</span>
				<span class="text-xs text-gray-400">{g.tasks.length} · {collapsed[g.key] ? '▸' : '▾'}</span>
			</button>
			{#if !collapsed[g.key]}
				<ul class="divide-y divide-gray-100 dark:divide-gray-800 rounded-b-2xl">
					{#each g.tasks as t (t.id)}
						{@const busy = busyId === t.id}
						<li class="relative flex items-start gap-3 px-4 py-2.5 {busy ? 'opacity-60' : ''}">
							<span class="mt-1.5 w-2 h-2 rounded-full shrink-0" style="background:{SOURCE_META[t.source].color}" title={SOURCE_META[t.source].label}></span>
							<div class="flex-1 min-w-0">
								<div class="text-sm">{t.title}</div>
								{#if t.client}
									<div class="text-xs text-gray-500">
										{#if g.kind !== 'client'}{t.client.name} · {/if}<span class="text-gray-400">{clientLabel(t.client.via)}</span>
									</div>
								{:else if t.suggestion}
									<div class="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-2">
										<span>{t.suggestion.name}?</span>
										<button type="button" disabled={busy} on:click={() => act('accept', t)} title="Yes, this client"
											class="px-1.5 rounded border border-green-300 text-green-700 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-40">✓</button>
										<button type="button" disabled={busy} on:click={() => act('reject', t)} title="No, not this client"
											class="px-1.5 rounded border border-gray-300 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-850 disabled:opacity-40">✗</button>
									</div>
								{/if}
								{#if t.detail}<div class="text-xs text-gray-500 truncate">{t.detail}</div>{/if}
							</div>
							{#if t.dueAt}<span class="text-xs shrink-0 tabular-nums {t.status === 'overdue' ? 'text-red-600' : 'text-gray-400'}">{dueLabel(t)}</span>{/if}
							{#if t.writable}
								<button type="button" disabled={busy} on:click={() => act('complete', t)}
									class="text-xs font-medium px-2 py-0.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-850 disabled:opacity-40 shrink-0">Done</button>
							{:else}
								<button type="button" disabled={linkDisabled(t)} on:click={() => dispatch('open', t)}
									title={linkDisabled(t) ? 'XPLAN access is locked' : SOURCE_META[t.source].openLabel}
									class="text-xs text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-40 shrink-0">↗</button>
							{/if}
							<span class="relative shrink-0" data-todo-menu>
								<button type="button" disabled={busy} on:click={() => (menuFor = menuFor === t.id ? null : t.id)} title="More"
									class="text-xs text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-40 shrink-0 px-1">⋯</button>
								{#if menuFor === t.id}
									<div class="absolute right-0 top-6 z-10 w-56 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1 text-sm">
										{#if t.writable}
											<button type="button" class="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-850" on:click={() => snooze(t, 'tomorrow')}>Snooze to tomorrow</button>
											<button type="button" class="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-850" on:click={() => snooze(t, 'nextWeek')}>Snooze a week</button>
										{/if}
										<button type="button" class="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-850" on:click={() => act('assign', t)}>
											{t.client ? 'Change client…' : 'Assign client…'}
										</button>
										{#if t.client?.via === 'pin'}
											<button type="button" class="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-850" on:click={() => act('unpin', t)}>Clear client</button>
										{/if}
										{#if t.writable}
											<button type="button" disabled={linkDisabled(t)} class="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-850 disabled:opacity-40" on:click={() => { menuFor = null; dispatch('open', t); }}>
												{SOURCE_META[t.source].openLabel} ↗
											</button>
										{/if}
									</div>
								{/if}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/each}
</div>
