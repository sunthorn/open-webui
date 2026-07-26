<script lang="ts">
	// Clients — the hub for choosing who the planner works on.
	// Model: SYNC the XPLAN client book into axi (manual "Sync client book"),
	// then search it LOCALLY (instant, free). Also quick-pick Recent, Needs-
	// attention (from the briefing), and New leads. Selecting sets the global
	// active client. See docs/xplan-integration-plan.md.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getBriefing, getOutput, putOutput } from '$lib/apis/gateway';
	import { activeClient, recentClients, setActiveClient } from '$lib/apps/activeClient';
	import { loadLeads, upsertLead, enquiryProgress, ENQUIRY_STEPS, type Lead } from '$lib/apps/leads';
	import { gatherXplanClientPage, XplanCancelledError, type XplanClient } from '$lib/apis/xplan';

	let query = '';
	let attention: string[] = [];
	let leads: Lead[] = [];

	// The synced XPLAN client book (local copy).
	let book: XplanClient[] = [];
	let bookSyncedAt = '';
	// Resume cursor: the next page a sweep should read. >1 means a prior sweep
	// stopped partway (resume from there); 1 means start a fresh full sync.
	let bookNextPage = 1;
	let syncing = false;
	let syncErr = '';
	let syncProgress = '';
	// Lets the planner Stop a running sweep (aborts the in-flight page read and
	// halts the loop so no further pages fire).
	let syncController: AbortController | null = null;
	const stopSync = () => syncController?.abort();

	const token = () => localStorage.getItem('token') ?? '';
	const nowIso = () => new Date().toISOString();
	const newId = () =>
		'lead-' + (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.round(Math.random() * 1e6)}`).slice(0, 12);

	// Full timestamp: dd/mm/yy hh:mm (24h).
	const fmt = (iso: string) => {
		if (!iso) return '';
		const d = new Date(iso);
		if (isNaN(d.getTime())) return iso;
		const p = (n: number) => String(n).padStart(2, '0');
		return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)} ${p(d.getHours())}:${p(d.getMinutes())}`;
	};

	onMount(async () => {
		try {
			const b = await getBriefing(token());
			if (b) {
				const names = [...b.needsAttention, ...b.today].map((i) => i.client).filter((c): c is string => !!c);
				attention = Array.from(new Set(names));
			}
		} catch (e) {
			console.warn('briefing:', e);
		}
		try {
			leads = await loadLeads(token());
		} catch (e) {
			console.warn('leads:', e);
		}
		try {
			const doc = await getOutput<{ clients: XplanClient[]; syncedAt: string; nextPage?: number }>(
				token(),
				'clients'
			);
			if (doc) {
				book = doc.clients ?? [];
				bookSyncedAt = doc.syncedAt ?? '';
				bookNextPage = doc.nextPage ?? 1;
			}
		} catch (e) {
			console.warn('client book:', e);
		}
	});

	// Manual sync — sweeps the XPLAN client book page by page into axi
	// (token-spending). Bulk table reads are slow, so the sweep is RESILIENT and
	// RESUMABLE rather than all-or-nothing:
	//  • each page gets a generous timeout and one retry;
	//  • a page that still fails stops the sweep but saves a resume cursor
	//    (nextPage) — clicking Sync again continues from that exact page instead
	//    of discarding the whole run (the old behaviour on a single timeout);
	//  • progress is persisted after every page; a resume seeds from the saved
	//    book so nothing already synced is lost or needlessly re-read.
	const MAX_PAGES = 30;
	const PAGE_TIMEOUT_MS = 180_000; // ~100-row table reads are slow — give each room

	const persistBook = async (m: Map<string, XplanClient>, next: number) => {
		book = Array.from(m.values());
		bookSyncedAt = nowIso();
		bookNextPage = next;
		await putOutput(token(), 'clients', 'client_book', {
			clients: book,
			syncedAt: bookSyncedAt,
			nextPage: next
		});
	};

	const syncBook = async () => {
		if (syncing) return;
		syncing = true;
		syncErr = '';
		syncController = new AbortController();
		const signal = syncController.signal;
		// Resume a stopped sweep (seed from the saved book, start at the cursor);
		// otherwise start a fresh full sync from page 1.
		const resuming = bookNextPage > 1;
		const map = new Map<string, XplanClient>(
			resuming ? book.map((c) => [c.id || c.name.toLowerCase(), c] as [string, XplanClient]) : []
		);
		const start = resuming ? bookNextPage : 1;
		let total = 0;
		syncProgress = resuming ? `Resuming at page ${start}…` : 'Starting…';
		try {
			for (let page = start; page <= MAX_PAGES; page++) {
				if (signal.aborted) {
					await persistBook(map, page); // resume here on next Sync
					syncErr = `Stopped — ${map.size}${total ? ` of ${total}` : ''} synced. Click Resume sync to continue.`;
					break;
				}
				syncProgress = `Reading page ${page}${total ? ` · ${map.size} of ${total}` : ` · ${map.size} so far`}…`;
				// Retry a slow/failed page once before giving up on it.
				let res: Awaited<ReturnType<typeof gatherXplanClientPage>> | null = null;
				let cancelled = false;
				for (let attempt = 1; attempt <= 2 && res === null; attempt++) {
					try {
						res = await gatherXplanClientPage(token(), page, PAGE_TIMEOUT_MS, signal);
					} catch (e) {
						if (e instanceof XplanCancelledError) {
							cancelled = true;
							break;
						}
						res = null;
					}
				}
				if (cancelled) {
					await persistBook(map, page); // resume here on next Sync
					syncErr = `Stopped — ${map.size}${total ? ` of ${total}` : ''} synced. Click Resume sync to continue.`;
					break;
				}
				if (res === null) {
					// Failed twice — stop, but stay resumable at THIS page.
					await persistBook(map, page);
					syncErr = `Page ${page} didn’t load — ${map.size}${total ? ` of ${total}` : ''} synced. Click Sync to resume from here.`;
					break;
				}
				if (res === 'NOT_LOGGED_IN') {
					if (map.size === 0)
						syncErr = 'XPLAN isn’t connected/logged in. Open Home to connect, then sync.';
					break;
				}
				if (res.total) total = res.total;
				const before = map.size;
				for (const c of res.rows) {
					const k = c.id || c.name.toLowerCase();
					if (!map.has(k)) map.set(k, c);
				}
				const added = map.size - before;
				const done = res.rows.length === 0 || (!!total && map.size >= total);
				// nextPage: 1 when complete (next Sync is a fresh refresh), else advance.
				await persistBook(map, done ? 1 : page + 1);
				if (done) break;
				if (added === 0) {
					syncErr = `Sync paused at page ${page} — no new clients returned (${map.size}${total ? ` of ${total}` : ''}). Likely the end; click Sync to try again.`;
					break;
				}
			}
		} catch (e: any) {
			syncErr = typeof e === 'string' ? e : (e?.message ?? 'Sync failed');
		} finally {
			syncing = false;
			syncProgress = '';
			syncController = null;
		}
	};

	const pickExisting = (name: string, id = '') => {
		setActiveClient({ id: id || '', name, mode: 'existing', since: nowIso() });
		goto('/apps/clients/detail');
	};

	const createNew = async () => {
		const name = query.trim();
		if (!name) return;
		const lead: Lead = { id: newId(), name, createdAt: nowIso(), stage: 'enquiry', enquiry: {} };
		try {
			leads = await upsertLead(token(), lead);
		} catch (e) {
			console.warn('persist lead:', e);
		}
		setActiveClient({ id: lead.id, name, mode: 'new', since: nowIso() });
		goto('/apps/enquiry');
	};

	const openLead = (lead: Lead) => {
		setActiveClient({ id: lead.id, name: lead.name, mode: 'new', since: nowIso() });
		goto('/apps/enquiry');
	};

	$: q = query.trim().toLowerCase();
	// Show the synced book: when searching, show ALL matches; when browsing, show
	// a growing window (browseLimit) with a "Show more" control so the planner can
	// page through the whole book instead of being capped at 50.
	const BROWSE_STEP = 50;
	let browseLimit = BROWSE_STEP;
	$: bookMatches = q ? book.filter((c) => c.name.toLowerCase().includes(q)) : book;
	$: bookFiltered = q ? bookMatches : bookMatches.slice(0, browseLimit);
	$: recentFiltered = $recentClients.filter((c) => !q || c.name.toLowerCase().includes(q));
	$: attentionFiltered = attention.filter((n) => !q || n.toLowerCase().includes(q));
	$: openLeads = leads.filter((l) => l.stage === 'enquiry');
</script>

<div class="max-w-3xl mx-auto px-8 py-10">
	<div class="flex items-start justify-between gap-4 mb-6">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Clients</h1>
			<p class="text-sm text-gray-500 mt-1">Search your synced XPLAN book, or create a new client.</p>
		</div>
		<div class="shrink-0 flex items-center gap-2">
			{#if syncing}
				<button
					on:click={stopSync}
					class="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-xl border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition"
				>
					<span class="size-2 rounded-[2px] bg-red-500"></span>
					Stop
				</button>
			{/if}
			<button
				on:click={syncBook}
				disabled={syncing}
				class="inline-flex items-center gap-2 text-sm font-medium px-3.5 py-2 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-850 disabled:opacity-50 transition"
			>
				{#if syncing}
					<svg class="size-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
					Syncing…
				{:else}
					{bookNextPage > 1 ? 'Resume sync' : 'Sync client book'}
				{/if}
			</button>
		</div>
	</div>

	<!-- Sync status -->
	<p class="text-xs text-gray-400 mb-4">
		{#if syncing && syncProgress}
			<span>{syncProgress}</span>
		{:else if syncErr}
			<span class="text-red-500">{syncErr}</span>
		{:else if book.length && bookNextPage > 1}
			<span class="text-amber-600 dark:text-amber-400">{book.length} synced so far · partial</span> — click
			<span class="font-medium">Resume sync</span> to continue from page {bookNextPage}.
		{:else if book.length}
			{book.length} clients synced{bookSyncedAt ? ` · ${fmt(bookSyncedAt)}` : ''}. Searching your local copy.
		{:else}
			Client book not synced yet — click <span class="font-medium">Sync client book</span> to pull your XPLAN clients in (needs XPLAN connected on Home).
		{/if}
	</p>

	<!-- Search -->
	<div class="relative mb-3">
		<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor" class="size-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
			<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
		</svg>
		<input
			bind:value={query}
			placeholder="Search by client name, or type a new client’s name…"
			class="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 pl-11 pr-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10"
		/>
	</div>

	<!-- Create-new affordance -->
	{#if q}
		<button
			on:click={createNew}
			class="w-full flex items-center gap-3 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 px-4 py-3 text-sm hover:bg-gray-50 dark:hover:bg-gray-850 transition mb-6"
		>
			<span class="size-8 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 flex items-center justify-center text-lg leading-none shrink-0">+</span>
			<span>Create new client “<span class="font-medium">{query.trim()}</span>” → start a New Enquiry</span>
		</button>
	{/if}

	<!-- Recent -->
	{#if recentFiltered.length}
		<section class="mb-6">
			<h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Recent</h2>
			<div class="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
				{#each recentFiltered as c}
					<button on:click={() => pickExisting(c.name, c.id)} class="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-850 transition">
						<span class="size-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs font-semibold shrink-0">{c.name.slice(0, 1).toUpperCase()}</span>
						<span class="flex-1 min-w-0 truncate {$activeClient && $activeClient.name === c.name ? 'font-semibold' : ''}">{c.name}</span>
						{#if c.mode === 'new'}<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">new</span>{/if}
					</button>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Needs attention -->
	{#if attentionFiltered.length}
		<section class="mb-6">
			<h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Needs attention · from today’s briefing</h2>
			<div class="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
				{#each attentionFiltered as name}
					<button on:click={() => pickExisting(name)} class="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-850 transition">
						<span class="size-1.5 rounded-full bg-red-500 shrink-0"></span>
						<span class="flex-1 min-w-0 truncate">{name}</span>
					</button>
				{/each}
			</div>
		</section>
	{/if}

	<!-- New leads -->
	<section>
		<h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">New leads</h2>
		{#if openLeads.filter((l) => !q || l.name.toLowerCase().includes(q)).length}
			<div class="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
				{#each openLeads.filter((l) => !q || l.name.toLowerCase().includes(q)) as lead}
					<button on:click={() => openLead(lead)} class="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-850 transition">
						<span class="size-8 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 flex items-center justify-center text-xs font-semibold shrink-0">{lead.name.slice(0, 1).toUpperCase()}</span>
						<span class="flex-1 min-w-0 truncate">{lead.name}</span>
						<span class="text-xs text-gray-400 tabular-nums">{enquiryProgress(lead)}/{ENQUIRY_STEPS.length} enquiry</span>
					</button>
				{/each}
			</div>
		{:else}
			<div class="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 px-4 py-5 text-center">
				<p class="text-sm text-gray-500">No new leads yet. Type a new client’s name above to create one.</p>
			</div>
		{/if}
	</section>

	<!-- Your clients (synced book): browse at the bottom; filters when searching -->
	{#if bookFiltered.length}
		<section class="mt-6">
			<h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
				{q ? 'Clients' : 'Your clients'} · {q ? bookFiltered.length : `${bookFiltered.length} of ${book.length}`}
			</h2>
			<div class="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden max-h-96 overflow-y-auto">
				{#each bookFiltered as c}
					<button on:click={() => pickExisting(c.name, c.id)} class="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-850 transition">
						<span class="size-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs font-semibold shrink-0">{c.name.slice(0, 1).toUpperCase()}</span>
						<span class="flex-1 min-w-0 truncate">{c.name}</span>
						{#if c.id}<span class="text-[10px] text-gray-400 tabular-nums">id {c.id}</span>{/if}
					</button>
				{/each}
			</div>
			{#if !q && browseLimit < book.length}
				<button
					on:click={() => (browseLimit += BROWSE_STEP)}
					class="mt-2 w-full text-xs font-medium text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 rounded-lg border border-gray-200 dark:border-gray-800 py-2 hover:bg-gray-50 dark:hover:bg-gray-850 transition"
				>
					Show more · {Math.min(BROWSE_STEP, book.length - browseLimit)} of {book.length - browseLimit} remaining
				</button>
			{/if}
		</section>
	{:else if q && book.length}
		<div class="mt-6 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 px-4 py-4 text-center text-sm text-gray-500">
			No synced client matched “{query.trim()}”. Create a new client above, or re-sync the book.
		</div>
	{/if}
</div>
