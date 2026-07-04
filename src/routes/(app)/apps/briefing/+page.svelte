<script lang="ts">
	// Briefing — the planner's morning agenda. Reads the pre-built briefing:daily
	// document through the contact-layer gateway (built overnight by hermes; for
	// now it may be manually seeded). Slice: Phase 4 walking skeleton.
	import { onMount } from 'svelte';
	import { getBriefing, type DailyBriefing, type BriefingItem } from '$lib/apis/gateway';

	type State = 'loading' | 'empty' | 'error' | 'ready';
	let state: State = 'loading';
	let errorMsg = '';
	let briefing: DailyBriefing | null = null;
	let greeting = 'Hello';

	$: sections = briefing
		? [
				{ key: 'needsAttention', label: 'Needs attention', warn: true, items: briefing.needsAttention },
				{ key: 'today', label: 'Today', warn: false, items: briefing.today },
				{ key: 'tomorrow', label: 'Tomorrow', warn: false, items: briefing.tomorrow },
				{ key: 'next7', label: 'Next 7 days', warn: false, items: briefing.next7 }
			].filter((s) => s.items && s.items.length > 0)
		: [];

	const chipClass = (s: BriefingItem['status']) =>
		({
			overdue: 'text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-900/40',
			due: 'text-gray-600 bg-gray-100 dark:text-gray-300 dark:bg-gray-800',
			upcoming: 'text-blue-700 bg-blue-100 dark:text-blue-300 dark:bg-blue-900/40',
			done: 'text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-900/40'
		})[s] ?? 'text-gray-600 bg-gray-100';

	const load = async () => {
		state = 'loading';
		errorMsg = '';
		try {
			const token = localStorage.getItem('token') ?? '';
			briefing = await getBriefing(token);
			state = briefing ? 'ready' : 'empty';
		} catch (e: any) {
			errorMsg = typeof e === 'string' ? e : (e?.message ?? 'Could not load briefing');
			state = 'error';
		}
	};

	onMount(() => {
		const h = new Date().getHours();
		greeting = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
		load();
	});

	const compiledLabel = (iso: string) => {
		try {
			return new Date(iso).toLocaleString(undefined, {
				weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
			});
		} catch {
			return iso;
		}
	};
</script>

<div class="max-w-3xl mx-auto px-8 py-10">
	<div class="flex items-start justify-between gap-4 mb-8">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">{greeting}</h1>
			<p class="text-sm text-gray-500 mt-1">
				Your briefing{#if briefing} · compiled {compiledLabel(briefing.compiledAt)} · {briefing.sources.join(', ')}{/if}
			</p>
		</div>
		<button
			on:click={load}
			disabled={state === 'loading'}
			class="shrink-0 text-sm font-medium px-3.5 py-2 rounded-xl bg-black text-white dark:bg-white dark:text-black hover:opacity-90 disabled:opacity-50 transition"
		>
			{state === 'loading' ? 'Loading…' : 'Reload'}
		</button>
	</div>

	{#if state === 'loading'}
		<p class="text-sm text-gray-500">Loading your briefing…</p>
	{:else if state === 'error'}
		<div class="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-6 text-sm">
			<p class="font-medium text-red-700 dark:text-red-400">Couldn't load the briefing.</p>
			<p class="mt-1 text-red-600/80 dark:text-red-400/80">{errorMsg}</p>
			<button on:click={load} class="mt-3 underline underline-offset-2 text-red-700 dark:text-red-400">Try again</button>
		</div>
	{:else if state === 'empty'}
		<div class="rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-850 p-8 text-center">
			<p class="text-sm text-gray-600 dark:text-gray-300 font-medium">No briefing yet.</p>
			<p class="text-sm text-gray-500 mt-1">Your briefing is compiled overnight. Once it runs, today's agenda appears here.</p>
		</div>
	{:else}
		<div class="space-y-8">
			{#each sections as section}
				<div>
					<h2 class="text-xs font-semibold uppercase tracking-wide mb-3 {section.warn ? 'text-red-600 dark:text-red-400' : 'text-gray-500'}">
						{#if section.warn}⚠ {/if}{section.label}
					</h2>
					<ul class="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
						{#each section.items as item}
							<li class="flex items-start gap-3 px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-850">
								<span class="text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded mt-0.5 shrink-0 {chipClass(item.status)}">
									{item.status}
								</span>
								<div class="flex-1 min-w-0">
									<div class="text-sm font-medium">{item.title}</div>
									{#if item.client || item.detail}
										<div class="text-xs text-gray-500 truncate">
											{[item.client, item.detail].filter(Boolean).join(' · ')}
										</div>
									{/if}
								</div>
								{#if item.dueAt}
									<span class="text-xs text-gray-400 shrink-0 tabular-nums">{item.dueAt}</span>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/each}
			<p class="text-xs text-gray-400">
				Sources: {briefing?.sources.join(', ')}. Chats stay in Open WebUI's native history.
			</p>
		</div>
	{/if}
</div>
