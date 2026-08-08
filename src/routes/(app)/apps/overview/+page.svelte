<script lang="ts">
	// Home — Today's overview. Merges the connection checklist, the live Briefing
	// agenda (Build B: real XPLAN tasks/diary, not sample), and the raw dashboard
	// read onto one page.
	//   • Check connection — FREE (gateway probes the debug Chrome, no LLM).
	//   • Refresh briefing / Sync dashboard — spend tokens; explicit, ~1–2×/day.
	import { onMount, onDestroy } from 'svelte';
	import {
		syncXplanOverview,
		gatherXplanBriefing,
		computeBriefing,
		XplanCancelledError
	} from '$lib/apis/xplan';
	import {
		getOverviewSnapshot,
		saveOverviewSnapshot,
		getXplanAccess,
		getXplanStatus,
		getBriefing,
		saveBriefing,
		type XplanAccessLevel,
		type DailyBriefing,
		type BriefingItem
	} from '$lib/apis/gateway';

	let greeting = 'Hello';
	let today = '';

	const token = () => localStorage.getItem('token') ?? '';

	// --- connection (free probe) ---
	let probed = false;
	let browserUp = false;
	let loggedIn: boolean | null = null;
	let accessLevel: XplanAccessLevel = 'lock';
	// Derived alias kept so canSync below reads clearly.
	$: guardrailLocked = accessLevel === 'lock';

	// The Sync/Refresh actions can be attempted whenever the browser is up, access
	// is unlocked, and we're not known-logged-out (loggedIn may be null: the
	// actions navigate to XPLAN themselves and surface NOT_LOGGED_IN if needed).
	// Connection state itself is shown by the top-bar status pill.
	$: canSync = browserUp && loggedIn !== false && !guardrailLocked;

	// --- briefing (live) ---
	let briefing: DailyBriefing | null = null;
	let briefingState: 'idle' | 'loading' | 'error' = 'idle';
	let briefingErr = '';

	// --- dashboard read (sync) ---
	let syncState: 'idle' | 'loading' | 'done' | 'error' = 'idle';
	let lines: string[] = [];
	let syncedAt = '';
	let syncErr = '';

	// Stop controls — each agent read can be aborted mid-flight.
	let syncCtrl: AbortController | null = null;
	let briefCtrl: AbortController | null = null;
	const stopSync = () => syncCtrl?.abort();
	const stopBriefing = () => briefCtrl?.abort();

	// Full timestamp: dd/mm/yy hh:mm (24h).
	const fmt = (iso: string) => {
		if (!iso) return '';
		const d = new Date(iso);
		if (isNaN(d.getTime())) return iso;
		const p = (n: number) => String(n).padStart(2, '0');
		return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)} ${p(d.getHours())}:${p(d.getMinutes())}`;
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
		try {
			const [status, lvl] = await Promise.all([
				getXplanStatus(token()).catch(() => ({ browserUp: false, loggedIn: null }) as any),
				getXplanAccess(token()).catch(() => accessLevel)
			]);
			browserUp = !!status.browserUp;
			loggedIn = status.loggedIn;
			accessLevel = lvl;
		} finally {
			probed = true;
		}
	};

	// Auto-recheck so the badge stays honest without a manual click: every 30s,
	// and immediately when the planner returns to the tab/window.
	let recheckTimer: ReturnType<typeof setInterval> | null = null;
	const onFocus = () => {
		if (document.visibilityState === 'visible') checkConnection();
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

		// Keep the badge honest: poll every 30s and on tab focus.
		recheckTimer = setInterval(checkConnection, 30_000);
		document.addEventListener('visibilitychange', onFocus);
		window.addEventListener('focus', onFocus);
	});

	onDestroy(() => {
		if (recheckTimer) clearInterval(recheckTimer);
		document.removeEventListener('visibilitychange', onFocus);
		window.removeEventListener('focus', onFocus);
	});

	// SPENDS TOKENS — live-read today's tasks/diary and rebuild the briefing.
	const refreshBriefing = async () => {
		briefingState = 'loading';
		briefingErr = '';
		briefCtrl = new AbortController();
		try {
			const t = token();
			const raw = await gatherXplanBriefing(t, 120_000, briefCtrl.signal);
			if (raw === 'NOT_LOGGED_IN') {
				loggedIn = false;
				briefingState = 'idle';
				return;
			}
			briefing = computeBriefing(raw);
			await saveBriefing(t, briefing);
			briefingState = 'idle';
		} catch (e: any) {
			if (e instanceof XplanCancelledError) {
				briefingState = 'idle'; // clean stop, not an error
				return;
			}
			briefingErr = typeof e === 'string' ? e : (e?.message ?? 'Refresh failed');
			briefingState = 'error';
		} finally {
			briefCtrl = null;
		}
	};

	// SPENDS TOKENS — raw dashboard summary.
	const syncDashboard = async () => {
		syncState = 'loading';
		syncErr = '';
		syncCtrl = new AbortController();
		try {
			const t = token();
			const summary = await syncXplanOverview(t, 90_000, syncCtrl.signal);
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
			if (e instanceof XplanCancelledError) {
				syncState = lines.length ? 'done' : 'idle'; // clean stop
				return;
			}
			syncErr = typeof e === 'string' ? e : (e?.message ?? 'Sync failed');
			syncState = 'error';
		} finally {
			syncCtrl = null;
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
		<!-- Connection + access now live in the top-bar status pill (global), so no
		     duplicate badge here. -->
	</div>

	<!-- The Connect-to-XPLAN checklist now lives in the top-bar status pill's
	     popover, so it is reachable from every page instead of only here. -->

	<!-- Dashboard read — shown when we can sync or we have a saved read -->
	{#if canSync || lines.length}
		<div class="rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-850 p-6 mb-5">
			<div class="flex items-center justify-between mb-3">
				<h2 class="text-sm font-semibold text-gray-500 uppercase tracking-wide">Dashboard read</h2>
				<div class="flex items-center gap-3">
					{#if syncedAt}<span class="text-xs text-gray-400">{fmt(syncedAt)}</span>{/if}
					{#if syncState === 'loading'}
						<button
							on:click={stopSync}
							class="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition"
						>
							<span class="size-2 rounded-[2px] bg-red-500"></span>
							Stop
						</button>
					{/if}
					{#if canSync}
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

	<!-- Briefing agenda — shown when we can sync or we have a saved one -->
	{#if canSync || !briefingEmpty}
		<div class="rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-850 p-6">
			<div class="flex items-center justify-between mb-4">
				<h2 class="text-sm font-semibold text-gray-500 uppercase tracking-wide">Today's briefing</h2>
				<div class="flex items-center gap-3">
					{#if briefing?.compiledAt}
						<span class="text-xs text-gray-400">Updated {fmt(briefing.compiledAt)}</span>
					{/if}
					{#if briefingState === 'loading'}
						<button
							on:click={stopBriefing}
							class="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition"
						>
							<span class="size-2 rounded-[2px] bg-red-500"></span>
							Stop
						</button>
					{/if}
					{#if canSync}
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

	<p class="text-xs text-gray-400 mt-4">
		Read from your logged-in XPLAN in real time. The agent only reads — it never changes anything in XPLAN.
	</p>
</div>
