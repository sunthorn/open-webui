<script lang="ts">
	// Overview / Today — Slice 1, Stage B.
	// Leads with a "Connect to XPLAN" checklist (debug Chrome up → signed in →
	// guardrail unlocked). Once a sync returns real data the checklist collapses
	// and the dashboard read is shown. The last sync is persisted, so re-opening
	// Overview restores it without re-running the (slow) live read.
	import { onMount } from 'svelte';
	import { syncXplanOverview } from '$lib/apis/xplan';
	import {
		getOverviewSnapshot,
		saveOverviewSnapshot,
		getGuardrail,
		setGuardrail
	} from '$lib/apis/gateway';

	let greeting = 'Hello';
	let today = '';

	type State = 'idle' | 'loading' | 'done' | 'error';
	let state: State = 'idle';
	let lines: string[] = [];
	let errorMsg = '';
	let syncedAt = ''; // ISO 8601 of the last successful sync ('' = never)

	// Outcome of the most recent sync (or restored snapshot). Drives the
	// connection checklist below.
	type Result = 'none' | 'error' | 'notLoggedIn' | 'ok';
	let lastResult: Result = 'none';

	// Guardrail (XPLAN access) state — step ③.
	let guardrailLocked = true;
	let guardrailBusy = false;

	const token = () => localStorage.getItem('token') ?? '';

	// Derived connection steps ---------------------------------------------
	// ① browser reachable: hermes got *any* answer (logged-in or not) → up.
	$: step1 =
		lastResult === 'ok' || lastResult === 'notLoggedIn'
			? 'ok'
			: lastResult === 'error'
				? 'fail'
				: 'unknown';
	// ② signed in: only a real read proves it.
	$: step2 = lastResult === 'ok' ? 'ok' : lastResult === 'notLoggedIn' ? 'fail' : 'unknown';
	// ③ guardrail unlocked.
	$: step3 = guardrailLocked ? 'todo' : 'ok';
	$: connected = lastResult === 'ok';

	const fmtSynced = (iso: string) => {
		if (!iso) return '';
		const d = new Date(iso);
		const sameDay = d.toDateString() === new Date().toDateString();
		return sameDay
			? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
			: d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
	};

	onMount(async () => {
		const now = new Date();
		const h = now.getHours();
		greeting = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
		today = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

		// Restore the last saved sync.
		try {
			const snap = await getOverviewSnapshot(token());
			if (snap) {
				lines = snap.lines ?? [];
				syncedAt = snap.syncedAt ?? '';
				lastResult = snap.notLoggedIn ? 'notLoggedIn' : lines.length ? 'ok' : 'none';
				state = 'done';
			}
		} catch (e) {
			console.warn('Could not load saved overview snapshot:', e);
		}

		// Read the guardrail so step ③ reflects reality.
		try {
			guardrailLocked = await getGuardrail(token());
		} catch (e) {
			console.warn('Could not read guardrail state:', e);
		}
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

	const sync = async () => {
		state = 'loading';
		errorMsg = '';
		try {
			const t = token();
			const summary = await syncXplanOverview(t);
			if (summary.includes('NOT_LOGGED_IN')) {
				lastResult = 'notLoggedIn';
				lines = [];
			} else {
				lines = summary
					.split('\n')
					.map((l) => l.replace(/^[-•*]\s*/, '').trim())
					.filter((l) => l.length > 0);
				lastResult = 'ok';
			}
			syncedAt = new Date().toISOString();
			state = 'done';
			try {
				await saveOverviewSnapshot(t, { lines, notLoggedIn: lastResult === 'notLoggedIn', syncedAt });
			} catch (e) {
				console.warn('Could not save overview snapshot:', e);
			}
		} catch (e: any) {
			errorMsg = typeof e === 'string' ? e : (e?.message ?? 'Sync failed');
			lastResult = 'error';
			state = 'error';
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
		<button
			on:click={sync}
			disabled={state === 'loading'}
			class="shrink-0 inline-flex items-center gap-2 text-sm font-medium px-3.5 py-2 rounded-xl
				bg-black text-white dark:bg-white dark:text-black
				hover:opacity-90 disabled:opacity-50 disabled:cursor-wait transition"
		>
			{#if state === 'loading'}
				<svg class="size-4 animate-spin" viewBox="0 0 24 24" fill="none">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
				</svg>
				Reading XPLAN…
			{:else}
				{connected ? 'Resync' : 'Connect & sync'}
			{/if}
		</button>
	</div>

	<!-- Connect checklist — shown until XPLAN returns a real read -->
	{#if !connected}
		<div class="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 mb-5">
			<h2 class="text-base font-semibold">Connect to XPLAN</h2>
			<p class="text-sm text-gray-500 mt-1 mb-4">
				Three quick steps and the agent can read your live XPLAN dashboard.
			</p>

			<ol class="space-y-4">
				<!-- Step 1: debug browser -->
				<li class="flex gap-3">
					<span class="mt-0.5 shrink-0 size-5 rounded-full flex items-center justify-center text-[11px] font-semibold
						{step1 === 'ok' ? 'bg-green-500 text-white' : step1 === 'fail' ? 'bg-amber-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-500'}">
						{step1 === 'ok' ? '✓' : '1'}
					</span>
					<div class="min-w-0">
						<p class="text-sm font-medium">Start the debug browser</p>
						{#if step1 !== 'ok'}
							<p class="text-xs text-gray-500 mt-0.5">Run this once in your terminal, from the project folder:</p>
							<code class="mt-1.5 block text-xs bg-gray-100 dark:bg-gray-850 rounded-lg px-3 py-2 select-all">./scripts/start-xplan-chrome.sh</code>
							{#if step1 === 'fail'}
								<p class="text-xs text-amber-600 dark:text-amber-400 mt-1.5">Couldn't reach the browser on the last try — is it running?</p>
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
								The browser is up but not signed in — log into XPLAN in that window.
							{:else}
								In the window that opens, sign in to XPLAN as usual (your session stays there).
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

			{#if state === 'error'}
				<p class="text-xs text-red-600 dark:text-red-400 mt-4">{errorMsg}</p>
			{/if}
		</div>
	{/if}

	<!-- Dashboard read — shown once connected -->
	{#if connected}
		<div class="rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-850 p-6 min-h-[10rem]">
			<div class="flex items-center justify-between mb-3">
				<h2 class="text-sm font-semibold text-gray-500 uppercase tracking-wide">From your XPLAN dashboard</h2>
				{#if syncedAt}
					<span class="text-xs text-gray-400">Last synced {fmtSynced(syncedAt)}</span>
				{/if}
			</div>
			<ul class="space-y-2">
				{#each lines as line}
					<li class="flex items-start gap-2.5 text-sm">
						<span class="mt-1.5 size-1.5 rounded-full bg-gray-400 shrink-0"></span>
						<span>{line}</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<p class="text-xs text-gray-400 mt-4">
		Slice 1 · Stage B — live data pulled from your logged-in XPLAN via hermes (read-only; nothing
		is written back).
	</p>
</div>
