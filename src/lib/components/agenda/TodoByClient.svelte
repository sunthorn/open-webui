<script lang="ts">
	// The accordion: Overdue → clients A–Z → Unassigned. Every item is a
	// deep-link in this build (writable is always false); Plan B adds Done.
	import type { AgendaTask } from '$lib/apis/gateway/agenda';
	import { SOURCE_META, groupTasks } from '$lib/apps/agenda';
	import { createEventDispatcher } from 'svelte';

	export let tasks: AgendaTask[] = [];
	export let today: string;
	export let xplanLocked = false;

	const dispatch = createEventDispatcher<{ open: AgendaTask }>();
	let collapsed: Record<string, boolean> = {};

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
	const disabled = (t: AgendaTask) => t.source === 'xplan' && xplanLocked;
</script>

{#if groups.length === 0}
	<p class="text-sm text-gray-500">No open tasks from any connected source.</p>
{/if}
<div class="space-y-3">
	{#each groups as g (g.key)}
		<section class="rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
			<button type="button" on:click={() => (collapsed[g.key] = !collapsed[g.key])}
				class="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-850">
				<span class="text-xs font-semibold uppercase tracking-wide {g.kind === 'overdue' ? 'text-red-600 dark:text-red-400' : 'text-gray-500'}">
					{#if g.kind === 'overdue'}⚠ {/if}{g.label}
				</span>
				<span class="text-xs text-gray-400">{g.tasks.length} · {collapsed[g.key] ? '▸' : '▾'}</span>
			</button>
			{#if !collapsed[g.key]}
				<ul class="divide-y divide-gray-100 dark:divide-gray-800">
					{#each g.tasks as t (t.id)}
						<li class="flex items-start gap-3 px-4 py-2.5">
							<span class="mt-1.5 w-2 h-2 rounded-full shrink-0" style="background:{SOURCE_META[t.source].color}" title={SOURCE_META[t.source].label}></span>
							<div class="flex-1 min-w-0">
								<div class="text-sm">{t.title}</div>
								{#if g.kind !== 'client' && t.client}<div class="text-xs text-gray-500">{t.client.name}</div>{/if}
								{#if t.detail}<div class="text-xs text-gray-500 truncate">{t.detail}</div>{/if}
							</div>
							{#if t.dueAt}<span class="text-xs shrink-0 tabular-nums {t.status === 'overdue' ? 'text-red-600' : 'text-gray-400'}">{dueLabel(t)}</span>{/if}
							<button type="button" disabled={disabled(t)} on:click={() => dispatch('open', t)}
								title={disabled(t) ? 'XPLAN access is locked' : SOURCE_META[t.source].openLabel}
								class="text-xs text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-40 shrink-0">↗</button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/each}
</div>
