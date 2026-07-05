<script lang="ts">
	// Overview / Today — Slice 1, Stage B.
	// Two clearly separated actions:
	//   • "Check connection" — FREE. Probes the debug Chrome via the gateway
	//     (no LLM), so the planner can confirm they're connected without cost.
	//   • "Sync from XPLAN"  — spends tokens (hermes reads + summarises the
	//     dashboard). Only shown once connected, so it's a deliberate, ~1–2×/day
	//     action, not something that fires on every connection check.
	// The last sync is persisted and restored on open.
	import { onMount } from 'svelte';
	import { syncXplanOverview } from '$lib/apis/xplan';
	import {
		getOverviewSnapshot,
		saveOverviewSnapshot,
		getGuardrail,
		setGuardrail,
		getXplanStatus
	} from '$lib/apis/gateway';

	let greeting = 'Hello';
	let today = '';

	// Sync (token-spending) state.
	type SyncState = 'idle' | 'loading' | 'done' | 'error';
	let syncState: SyncState = 'idle';
	let lines: string[] = [];
	let syncedAt = ''; // ISO of the last successful sync ('' = never)
	let errorMsg = '';

	// Connection (free probe) state.
	let checking = false;
	let probed = false; // have we run at least one probe this session?
	let browserUp = false;
	let loggedIn: boolean | null = null;
	let guardrailLocked = true;
	let guardrailBusy = false;

	const token = () => localStorage.getItem('token') ?? '';

	$: step1 = !probed ? 'unknown' : browserUp ? 'ok' : 'todo';
	$: step2 = loggedIn === true ? 'ok' : loggedIn === false ? 'fail' : 'unknown';
	$: step3 = guardrailLocked ? 'todo' : 'ok';
	$: connected = browserUp && loggedIn === true && !guardrailLocked;

	const fmtSynced = (iso: string) => {
		if (!iso) return '';
		const d = new Date(iso);
		const sameDay = d.toDateString() === new Date().toDateString();
		return sameDay
			? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
			: d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
	};

	// FREE — no tokens. Probes browser + login + guardrail via the gateway.
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

		// Restore the last saved sync (free — it's just our own store).
		try {
			const snap = await getOverviewSnapshot(token());
			if (snap) {
				lines = snap.lines ?? [];
				syncedAt = snap.syncedAt ?? '';
				if (lines.length) syncState = 'done';
			}
		} catch (e) {
			console.warn('Could not load saved overview snapshot:', e);
		}

		await checkConnection(); // free probe on open
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

	// SPENDS TOKENS — explicit action, only offered once connected.
	const sync = async () => {
		syncState = 'loading';
		errorMsg = '';
		try {
			const t = token();
			const summary = await syncXplanOverview(t);
			if (summary.includes('NOT_LOGGED_IN')) {
				loggedIn = false; // kicks the checklist back open
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
			errorMsg = typeof e === 'string' ? e : (e?.message ?? 'Sync failed');
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
		{#if connected}
			<button
				on:click={sync}
				disabled={syncState === 'loading'}
				class="shrink-0 inline-flex items-center gap-2 text-sm font-medium px-3.5 py-2 rounded-xl
					bg-black text-white dark:bg-white dark:text-black hover:opacity-90 disabled:opacity-50 disabled:cursor-wait transition"
			>
				{#if syncState === 'loading'}
					<svg class="size-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
					Reading XPLAN…
				{:else}
					{lines.length ? 'Resync' : 'Sync from XPLAN'}
				{/if}
			</button>
		{:else}
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

	<!-- Connect checklist — shown until connected -->
	{#if !connected}
		<div class="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 mb-5">
			<h2 class="text-base font-semibold">Connect to XPLAN</h2>
			<p class="text-sm text-gray-500 mt-1 mb-4">
				Three quick steps, then <span class="font-medium">Sync from XPLAN</span> reads your dashboard.
				Checking the connection is free — only syncing uses the AI.
			</p>

			<ol class="space-y-4">
				<!-- Step 1: debug browser -->
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

				<!-- Step 2: sign in -->
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

				<!-- Step 3: guardrail -->
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

			{#if lines.length}
				<p class="text-xs text-gray-400 mt-5 pt-4 border-t border-gray-100 dark:border-gray-800">
					Showing your last sync from {fmtSynced(syncedAt)} below — reconnect to refresh it.
				</p>
			{/if}
		</div>
	{/if}

	<!-- Dashboard read — shown when connected, or when we have a saved sync -->
	{#if connected || lines.length}
		<div class="rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-850 p-6 min-h-[8rem]">
			<div class="flex items-center justify-between mb-3">
				<h2 class="text-sm font-semibold text-gray-500 uppercase tracking-wide">From your XPLAN dashboard</h2>
				{#if syncedAt}
					<span class="text-xs text-gray-400">Last synced {fmtSynced(syncedAt)}</span>
				{/if}
			</div>

			{#if syncState === 'error'}
				<div class="text-sm text-red-600 dark:text-red-400">
					<p class="font-medium">Couldn't read XPLAN.</p>
					<p class="mt-1 text-red-500/80">{errorMsg}</p>
				</div>
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
				<p class="text-sm text-gray-500">
					You're connected. Click <span class="font-medium">Sync from XPLAN</span> to load today's dashboard.
				</p>
			{/if}
		</div>
	{/if}

	<p class="text-xs text-gray-400 mt-4">
		Slice 1 · Stage B — live data pulled from your logged-in XPLAN via hermes (read-only; nothing
		is written back).
	</p>
</div>
