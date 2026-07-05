<script lang="ts">
	// Overview / Today — Slice 1, Stage B.
	// Button-triggered live read of the planner's XPLAN dashboard via hermes.
	// (A deep auto-scrape on mount is intentionally avoided: it is slow and
	// makes the agent thrash. See src/lib/apis/xplan.)
	import { onMount } from 'svelte';
	import { syncXplanOverview } from '$lib/apis/xplan';
	import { getOverviewSnapshot, saveOverviewSnapshot } from '$lib/apis/gateway';

	let greeting = 'Hello';
	let today = '';

	type State = 'idle' | 'loading' | 'done' | 'error';
	let state: State = 'idle';
	let lines: string[] = [];
	let notLoggedIn = false;
	let errorMsg = '';
	let syncedAt = ''; // ISO 8601 of the last successful sync ('' = never)

	// Friendly label for a stored ISO timestamp.
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

		// Restore the last saved sync so the planner doesn't have to re-run it.
		try {
			const snap = await getOverviewSnapshot(localStorage.getItem('token') ?? '');
			if (snap) {
				lines = snap.lines ?? [];
				notLoggedIn = snap.notLoggedIn ?? false;
				syncedAt = snap.syncedAt ?? '';
				state = 'done';
			}
		} catch (e) {
			console.warn('Could not load saved overview snapshot:', e);
		}
	});

	const sync = async () => {
		state = 'loading';
		errorMsg = '';
		notLoggedIn = false;
		try {
			const token = localStorage.getItem('token') ?? '';
			const summary = await syncXplanOverview(token);
			if (summary.includes('NOT_LOGGED_IN')) {
				notLoggedIn = true;
				lines = [];
			} else {
				lines = summary
					.split('\n')
					.map((l) => l.replace(/^[-•*]\s*/, '').trim())
					.filter((l) => l.length > 0);
			}
			syncedAt = new Date().toISOString();
			state = 'done';
			// Persist so the next visit shows this without re-running the sync.
			try {
				await saveOverviewSnapshot(token, { lines, notLoggedIn, syncedAt });
			} catch (e) {
				console.warn('Could not save overview snapshot:', e);
			}
		} catch (e: any) {
			errorMsg = typeof e === 'string' ? e : (e?.message ?? 'Sync failed');
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
				Sync from XPLAN
			{/if}
		</button>
	</div>

	<!-- Live panel -->
	<div class="rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-850 p-6 min-h-[10rem]">
		<div class="flex items-center justify-between mb-3">
			<h2 class="text-sm font-semibold text-gray-500 uppercase tracking-wide">
				From your XPLAN dashboard
			</h2>
			{#if state === 'done' && !notLoggedIn && syncedAt}
				<span class="text-xs text-gray-400">Last synced {fmtSynced(syncedAt)}</span>
			{/if}
		</div>

		{#if state === 'idle'}
			<p class="text-sm text-gray-500">
				Click <span class="font-medium">Sync from XPLAN</span> to pull a live read of your
				logged-in XPLAN dashboard.
			</p>
		{:else if state === 'loading'}
			<p class="text-sm text-gray-500">Reading your XPLAN dashboard — this takes ~15 seconds…</p>
		{:else if state === 'error'}
			<div class="text-sm text-red-600 dark:text-red-400">
				<p class="font-medium">Couldn't reach XPLAN.</p>
				<p class="mt-1 text-red-500/80">{errorMsg}</p>
				<button on:click={sync} class="mt-3 underline underline-offset-2">Try again</button>
			</div>
		{:else if notLoggedIn}
			<div class="text-sm text-amber-600 dark:text-amber-400">
				<p class="font-medium">Your XPLAN session isn't logged in.</p>
				<p class="mt-1">Open the debug Chrome, sign in to XPLAN, then sync again.</p>
			</div>
		{:else}
			<ul class="space-y-2">
				{#each lines as line}
					<li class="flex items-start gap-2.5 text-sm">
						<span class="mt-1.5 size-1.5 rounded-full bg-gray-400 shrink-0"></span>
						<span>{line}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<p class="text-xs text-gray-400 mt-4">
		Slice 1 · Stage B — live data pulled from your logged-in XPLAN via hermes (read-only; nothing
		is written back).
	</p>
</div>
