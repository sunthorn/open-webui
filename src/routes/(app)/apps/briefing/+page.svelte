<script lang="ts">
	// Briefing — the planner's morning agenda. Reads the pre-built briefing:daily
	// document through the contact-layer gateway (built overnight by hermes; for
	// now it may be manually seeded). Slice: Phase 4 walking skeleton.
	import { onMount } from 'svelte';
	import { getBriefing, saveBriefing, type DailyBriefing, type BriefingItem } from '$lib/apis/gateway';
	import { gatherXplanBriefing, computeBriefing, XplanCancelledError } from '$lib/apis/xplan';
	import XplanLink from '$lib/components/xplan/XplanLink.svelte';

	type State = 'loading' | 'empty' | 'error' | 'ready';
	let state: State = 'loading';
	let errorMsg = '';
	let briefing: DailyBriefing | null = null;
	let greeting = 'Hello';

	// Live refresh (spends tokens) — reads today's tasks/diary from XPLAN and
	// rebuilds the briefing, vs the initial mount which just reads the stored one.
	let refreshing = false;
	let refreshErr = '';
	let notLoggedIn = false;
	let refreshCtrl: AbortController | null = null;
	const stopRefresh = () => refreshCtrl?.abort();

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

	// SPENDS TOKENS — pull a fresh briefing live from XPLAN (needs XPLAN connected
	// on Home). Stoppable mid-read.
	const refresh = async () => {
		if (refreshing) return;
		refreshing = true;
		refreshErr = '';
		notLoggedIn = false;
		refreshCtrl = new AbortController();
		try {
			const token = localStorage.getItem('token') ?? '';
			const raw = await gatherXplanBriefing(token, 120_000, refreshCtrl.signal);
			if (raw === 'NOT_LOGGED_IN') {
				notLoggedIn = true;
				return;
			}
			briefing = computeBriefing(raw);
			await saveBriefing(token, briefing);
			state = 'ready';
		} catch (e: any) {
			if (e instanceof XplanCancelledError) return; // clean stop, not an error
			refreshErr = typeof e === 'string' ? e : (e?.message ?? 'Refresh failed');
		} finally {
			refreshing = false;
			refreshCtrl = null;
		}
	};

	onMount(() => {
		const h = new Date().getHours();
		greeting = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
		load();
	});

	// Full timestamp: dd/mm/yy hh:mm (24h).
	const compiledLabel = (iso: string) => {
		if (!iso) return '';
		const d = new Date(iso);
		if (isNaN(d.getTime())) return iso;
		const p = (n: number) => String(n).padStart(2, '0');
		return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)} ${p(d.getHours())}:${p(d.getMinutes())}`;
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
		<div class="shrink-0 flex items-center gap-2">
			<!-- Check the source: the briefing is built from tasks + diary. -->
			<XplanLink path="/xtasks/framelist/todo" label="Tasks" size="md" title="Open your XPLAN task list" />
			<XplanLink path="/diary/search?choice=my" label="Diary" size="md" title="Open your XPLAN diary" />
			{#if refreshing}
				<button
					on:click={stopRefresh}
					class="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-xl border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition"
				>
					<span class="size-2 rounded-[2px] bg-red-500"></span>
					Stop
				</button>
			{/if}
			<button
				on:click={refresh}
				disabled={refreshing || state === 'loading'}
				class="inline-flex items-center gap-2 text-sm font-medium px-3.5 py-2 rounded-xl bg-black text-white dark:bg-white dark:text-black hover:opacity-90 disabled:opacity-50 transition"
			>
				{#if refreshing}
					<svg class="size-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
					Reading…
				{:else}
					Refresh from XPLAN
				{/if}
			</button>
		</div>
	</div>

	{#if notLoggedIn}
		<div class="mb-5 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-4 py-3">
			XPLAN not connected — open <span class="font-medium">Home</span> and connect first, then refresh.
		</div>
	{/if}
	{#if refreshErr}
		<div class="mb-5 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-3">
			{refreshErr}
		</div>
	{/if}

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
