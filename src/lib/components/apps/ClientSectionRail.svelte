<script lang="ts">
	// The section rail: four XPLAN menus, one line per section, a dot for
	// its state. Sticky beside the pane on desktop; a <select> above it on
	// narrow screens. Presentation only — the page owns selection.
	import { createEventDispatcher } from 'svelte';
	import type { RailGroup, Dot } from '$lib/apps/clientSections';

	export let groups: RailGroup[] = [];
	export let selected: string | null = null;
	export let offsetTop = 16;

	const dispatch = createEventDispatcher<{ select: string }>();

	const DOT: Record<Dot, { cls: string; title: string }> = {
		current: { cls: 'bg-green-500', title: 'Current' },
		empty: { cls: 'border border-gray-400 dark:border-gray-500', title: 'Nothing recorded' },
		stale: { cls: 'bg-amber-500', title: 'Stale — page changed' },
		error: { cls: 'bg-red-500', title: 'Stale — read failed' }
	};
</script>

<!-- Narrow: one control, no scroll -->
<label class="md:hidden block mb-4">
	<span class="sr-only">Section</span>
	<select
		class="w-full text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2"
		value={selected ?? ''}
		on:change={(e) => dispatch('select', e.currentTarget.value)}
	>
		<option value="" disabled>Pick a section</option>
		{#each groups as g (g.key)}
			<optgroup label={g.label}>
				{#each g.entries as e (e.section)}
					<option value={e.section}>
						{e.label}{e.rowCount ? ` (${e.rowCount})` : ''} · {e.read ? DOT[e.dot].title : 'Not read yet'}
					</option>
				{/each}
			</optgroup>
		{/each}
	</select>
</label>

<!-- Desktop: the rail -->
<nav
	class="hidden md:block w-56 shrink-0 sticky self-start overflow-y-auto pr-2"
	style:top="{offsetTop}px"
	style:max-height="calc(100vh - {offsetTop + 16}px)"
	aria-label="Sections"
>
	{#each groups as g (g.key)}
		<p class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mt-4 first:mt-0 mb-1 px-2">{g.label}</p>
		<ul>
			{#each g.entries as e (e.section)}
				<li>
					<button
						type="button"
						on:click={() => dispatch('select', e.section)}
						aria-current={selected === e.section ? 'page' : undefined}
						class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-sm transition
							{selected === e.section
							? 'bg-gray-100 dark:bg-gray-850 font-medium'
							: 'hover:bg-gray-50 dark:hover:bg-gray-900 text-gray-600 dark:text-gray-300'}"
					>
						<span
							class="size-2 rounded-full shrink-0 {DOT[e.dot].cls}"
							title={e.read ? DOT[e.dot].title : 'Not read yet'}
						></span>
						<span class="flex-1 min-w-0 truncate">{e.label}</span>
						{#if e.rowCount}
							<span class="text-[11px] text-gray-400 tabular-nums">{e.rowCount}</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/each}
	<p class="mt-4 px-2 text-[10px] text-gray-400 leading-relaxed">
		<span class="inline-block size-2 rounded-full bg-green-500 align-middle"></span> current ·
		<span class="inline-block size-2 rounded-full border border-gray-400 align-middle"></span> empty ·
		<span class="inline-block size-2 rounded-full bg-amber-500 align-middle"></span> stale ·
		<span class="inline-block size-2 rounded-full bg-red-500 align-middle"></span> error
	</p>
</nav>
