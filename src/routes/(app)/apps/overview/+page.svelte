<script lang="ts">
	// Home — Today's overview. Merges the connection checklist, the live Briefing
	// agenda (Build B: real XPLAN tasks/diary, not sample), and the raw dashboard
	// read onto one page.
	//   • Check connection — FREE (gateway probes the debug Chrome, no LLM).
	//   • Refresh briefing / Sync dashboard — spend tokens; explicit, ~1–2×/day.
	import { onMount } from 'svelte';
	import {
		syncXplanOverview,
		gatherXplanBriefing,
		computeBriefing
	} from '$lib/apis/xplan';
	import {
		getOverviewSnapshot,
		saveOverviewSnapshot,
		getGuardrail,
		setGuardrail,
		getXplanStatus,
		getBriefing,
		saveBriefing,
		type DailyBriefing,
		type BriefingItem
	} from '$lib/apis/gateway';

	let greeting = 'Hello';
	let today = '';

	const token = () => localStorage.getItem('token') ?? '';

	// --- connection (free probe) ---
	let checking = false;
	let probed = false;
	let browserUp = false;
	let loggedIn: boolean | null = null;
	let guardrailLocked = true;
	let guardrailBusy = false;

	$: step1 = !probed ? 'unknown' : browserUp ? 'ok' : 'todo';
	$: step2 = loggedIn === true ? 'ok' : loggedIn === false ? 'fail' : 'unknown';
	$: step3 = guardrailLocked ? 'todo' : 'ok';
	$: connected = browserUp && loggedIn === true && !guardrailLocked;

	// --- briefing (live) ---
	let briefing: DailyBriefing | null = null;
	let briefingState: 'idle' | 'loading' | 'error' = 'idle';
	let briefingErr = '';

	// --- dashboard read (sync) ---
	let syncState: 'idle' | 'loading' | 'done' | 'error' = 'idle';
	let lines: string[] = [];
	let syncedAt = '';
	let syncErr = '';

	const fmt = (iso: string) => {
		if (!iso) return '';
		const d = new Date(iso);
		const sameDay = d.toDateString() === new Date().toDateString();
		return sameDay
			? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
			: d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
	};

	$: briefingEmpty =
		!briefing ||
		briefing.needsAttention.length +
			briefing.today.length +
			briefing.tomorrow.length +
			briefing.next7.length ===
			0;

	const dotClass = (s: BriefingItem['status']) =>
		s === 'overdue'
			? 'bg-red-500'
			: s === 'due'
				? 'bg-amber-500'
				: s === 'done'
					? 'bg-green-500'
					: 'bg-gray-400';

	const checkConnection = async () => {
		checking = true;
		try {
			const [status, locked] = await Promise.all([
				getXplanStatus(token()).catch(() => ({ browserUp: false, loggedIn: null }) as any),
				getGuardrail(token()).catch(() => guardrailLocked)
			]);
			browserUp = !!status.browserUp;
			loggedIn = status.loggedIn;
			guardrailLocked = locked;
		} finally {
			probed = true;
			checking = false;
		}
	};

	onMount(async () => {
		const now = new Date();
		const h = now.getHours();
		greeting = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
		today = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

		// Restore saved briefing + dashboard read (free — our own store).
		try {
			briefing = await getBriefing(token());
		} catch (e) {
			console.warn('Could not load briefing:', e);
		}
		try {
			const snap = await getOverviewSnapshot(token());
			if (snap) {
				lines = snap.lines ?? [];
				syncedAt = snap.syncedAt ?? '';
				if (lines.length) syncState = 'done';
			}
		} catch (e) {
			console.warn('Could not load overview snapshot:', e);
		}

		await checkConnection();
	});

	const toggleGuardrail = async () => {
		if (guardrailBusy) return;
		guardrailBusy = true;
		try {
			guardrailLocked = await setGuardrail(token(), !guardrailLocked);
		} catch (e) {
			console.warn('Could not change guardrail:', e);
		} finally {
			guardrailBusy = false;
		}
	};

	// SPENDS TOKENS — live-read today's tasks/diary and rebuild the briefing.
	const refreshBriefing = async () => {
		briefingState = 'loading';
		briefingErr = '';
		try {
			const t = token();
			const raw = await gatherXplanBriefing(t);
			if (raw === 'NOT_LOGGED_IN') {
				loggedIn = false;
				briefingState = 'idle';
				return;
			}
			briefing = computeBriefing(raw);
			await saveBriefing(t, briefing);
			briefingState = 'idle';
		} catch (e: any) {
			briefingErr = typeof e === 'string' ? e : (e?.message ?? 'Refresh failed');
			briefingState = 'error';
		}
	};

	// SPENDS TOKENS — raw dashboard summary.
	const syncDashboard = async () => {
		syncState = 'loading';
		syncErr = '';
		try {
			const t = token();
			const summary = await syncXplanOverview(t);
			if (summary.includes('NOT_LOGGED_IN')) {
				loggedIn = false;
				lines = [];
				syncState = 'idle';
				return;
			}
			lines = summary
				.split('\n')
				.map((l) => l.replace(/^[-•*]\s*/, '').trim())
				.filter((l) => l.length > 0);
			syncedAt = new Date().toISOString();
			syncState = 'done';
			try {
				await saveOverviewSnapshot(t, { lines, notLoggedIn: false, syncedAt });
			} catch (e) {
				console.warn('Could not save overview snapshot:', e);
			}
		} catch (e: any) {
			syncErr = typeof e === 'string' ? e : (e?.message ?? 'Sync failed');
			syncState = 'error';
		}
	};
</script>

<div class="max-w-3xl mx-auto px-8 py-10">
	<!-- Header -->
	<div class="flex items-start justify-between gap-4 mb-8">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">{greeting}</h1>
			<p class="text-sm text-gray-500 mt-1">{today} · Today's overview</p>
		</div>
		{#if !connected}
			<button
				on:click={checkConnection}
				disabled={checking}
				class="shrink-0 inline-flex items-center gap-2 text-sm font-medium px-3.5 py-2 rounded-xl
					border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-850 disabled:opacity-50 transition"
			>
				{#if checking}
					<svg class="size-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
					Checking…
				{:else}
					Check connection
				{/if}
			</button>
		{/if}
	</div>

	<!-- Connect checklist — until connected -->
	{#if !connected}
		<div class="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 mb-5">
			<h2 class="text-base font-semibold">Connect to XPLAN</h2>
			<p class="text-sm text-gray-500 mt-1 mb-4">
				Three quick steps, then you can refresh today's agenda. Checking the connection is free —
				only refreshing uses the AI.
			</p>
			<ol class="space-y-4">
				<li class="flex gap-3">
					<span class="mt-0.5 shrink-0 size-5 rounded-full flex items-center justify-center text-[11px] font-semibold
						{step1 === 'ok' ? 'bg-green-500 text-white' : step1 === 'todo' ? 'bg-amber-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-500'}">
						{step1 === 'ok' ? '✓' : '1'}
					</span>
					<div class="min-w-0">
						<p class="text-sm font-medium">Start the debug browser</p>
						{#if step1 !== 'ok'}
							<p class="text-xs text-gray-500 mt-0.5">Run this once in your terminal, from the project folder:</p>
							<code class="mt-1.5 block text-xs bg-gray-100 dark:bg-gray-850 rounded-lg px-3 py-2 select-all">./scripts/start-xplan-chrome.sh</code>
							{#if step1 === 'todo' && probed}
								<p class="text-xs text-amber-600 dark:text-amber-400 mt-1.5">Not detected yet — start it, then Check connection.</p>
							{/if}
						{/if}
					</div>
				</li>
				<li class="flex gap-3">
					<span class="mt-0.5 shrink-0 size-5 rounded-full flex items-center justify-center text-[11px] font-semibold
						{step2 === 'ok' ? 'bg-green-500 text-white' : step2 === 'fail' ? 'bg-amber-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-500'}">
						{step2 === 'ok' ? '✓' : '2'}
					</span>
					<div class="min-w-0">
						<p class="text-sm font-medium">Sign in to XPLAN</p>
						<p class="text-xs text-gray-500 mt-0.5">
							{#if step2 === 'fail'}
								The browser is up but not on a signed-in XPLAN page — log in in that window.
							{:else if step1 === 'ok' && step2 === 'unknown'}
								Open XPLAN in the debug window and sign in (no XPLAN tab detected yet).
							{:else}
								In the window that opens, sign in to XPLAN as usual — your session stays there.
							{/if}
						</p>
					</div>
				</li>
				<li class="flex gap-3 items-start">
					<span class="mt-0.5 shrink-0 size-5 rounded-full flex items-center justify-center text-[11px] font-semibold
						{step3 === 'ok' ? 'bg-green-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-500'}">
						{step3 === 'ok' ? '✓' : '3'}
					</span>
					<div class="flex-1 flex items-start justify-between gap-4">
						<div class="min-w-0">
							<p class="text-sm font-medium">Allow XPLAN access</p>
							<p class="text-xs text-gray-500 mt-0.5">Lets the agent use the browser. Turn off when you're done.</p>
						</div>
						<button
							role="switch"
							aria-checked={!guardrailLocked}
							aria-label="XPLAN access"
							disabled={guardrailBusy}
							on:click={toggleGuardrail}
							class="relative shrink-0 mt-0.5 w-11 h-6 rounded-full transition disabled:opacity-50
								{!guardrailLocked ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-700'}"
						>
							<span class="absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform {!guardrailLocked ? 'translate-x-5' : 'translate-x-0'}"></span>
						</button>
					</div>
				</li>
			</ol>
		</div>
	{/if}

	<!-- Briefing agenda (primary) — shown when connected or we have a saved one -->
	{#if connected || !briefingEmpty}
		<div class="rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-850 p-6 mb-5">
			<div class="flex items-center justify-between mb-4">
				<h2 class="text-sm font-semibold text-gray-500 uppercase tracking-wide">Today's briefing</h2>
				<div class="flex items-center gap-3">
					{#if briefing?.compiledAt}
						<span class="text-xs text-gray-400">Updated {fmt(briefing.compiledAt)}</span>
					{/if}
					{#if connected}
						<button
							on:click={refreshBriefing}
							disabled={briefingState === 'loading'}
							class="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-black text-white dark:bg-white dark:text-black hover:opacity-90 disabled:opacity-50 disabled:cursor-wait transition"
						>
							{#if briefingState === 'loading'}
								<svg class="size-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
								Reading…
							{:else}
								Refresh from XPLAN
							{/if}
						</button>
					{/if}
				</div>
			</div>

			{#if briefingState === 'error'}
				<p class="text-sm text-red-600 dark:text-red-400">{briefingErr}</p>
			{:else if briefingEmpty}
				<p class="text-sm text-gray-500">
					No agenda yet. Click <span class="font-medium">Refresh from XPLAN</span> to read today's tasks and diary.
				</p>
			{:else if briefing}
				<div class="space-y-5">
					{#each [['needsAttention', 'Needs attention'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['next7', 'Next 7 days']] as [key, label]}
						{@const items = briefing[key]}
						{#if items.length}
							<div>
								<h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{label}</h3>
								<ul class="space-y-1.5">
									{#each items as it}
										<li class="flex items-center gap-2.5 text-sm">
											<span class="size-1.5 rounded-full shrink-0 {dotClass(it.status)}"></span>
											<span class="{it.status === 'done' ? 'line-through text-gray-400' : ''}">{it.title}</span>
											{#if it.client}<span class="text-gray-400">· {it.client}</span>{/if}
											{#if it.dueAt}<span class="ml-auto text-xs text-gray-400 tabular-nums">{it.dueAt}</span>{/if}
										</li>
									{/each}
								</ul>
							</div>
						{/if}
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Dashboard read (secondary) — shown when connected or we have a saved read -->
	{#if connected || lines.length}
		<div class="rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-850 p-6">
			<div class="flex items-center justify-between mb-3">
				<h2 class="text-sm font-semibold text-gray-500 uppercase tracking-wide">Dashboard read</h2>
				<div class="flex items-center gap-3">
					{#if syncedAt}<span class="text-xs text-gray-400">{fmt(syncedAt)}</span>{/if}
					{#if connected}
						<button
							on:click={syncDashboard}
							disabled={syncState === 'loading'}
							class="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-900 disabled:opacity-50 disabled:cursor-wait transition"
						>
							{#if syncState === 'loading'}
								<svg class="size-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
								Reading…
							{:else}
								{lines.length ? 'Resync' : 'Sync'}
							{/if}
						</button>
					{/if}
				</div>
			</div>
			{#if syncState === 'error'}
				<p class="text-sm text-red-600 dark:text-red-400">{syncErr}</p>
			{:else if lines.length}
				<ul class="space-y-2">
					{#each lines as line}
						<li class="flex items-start gap-2.5 text-sm">
							<span class="mt-1.5 size-1.5 rounded-full bg-gray-400 shrink-0"></span>
							<span>{line}</span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-sm text-gray-500">A plain read of your XPLAN dashboard shell — click Sync to refresh.</p>
			{/if}
		</div>
	{/if}

	<p class="text-xs text-gray-400 mt-4">
		Read from your logged-in XPLAN in real time. The agent only reads — it never changes anything in XPLAN.
	</p>
</div>
