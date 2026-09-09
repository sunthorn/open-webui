<script lang="ts">
	// Clients — the hub for choosing who the planner works on.
	// Model: SYNC the XPLAN client book into axi (manual "Sync client book"),
	// then search it LOCALLY (instant, free). Also quick-pick Recent, Needs-
	// attention (from the briefing), and New leads. Selecting sets the global
	// active client. See docs/xplan-integration-plan.md.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { GatewayError, getBriefing, listAllClients } from '$lib/apis/gateway';
	import {
		activeClient,
		clearRecentClients,
		recentClients,
		setActiveClient
	} from '$lib/apps/activeClient';
	import { loadLeads, upsertLead, enquiryProgress, ENQUIRY_STEPS, type Lead } from '$lib/apps/leads';
	import { type XplanClient } from '$lib/apis/xplan';
	import { syncJobs, syncJobsError, startJob, stopJob, runningJob } from '$lib/stores/syncJobs';
	import XplanLink from '$lib/components/xplan/XplanLink.svelte';

	let query = '';
	let attention: string[] = [];
	let leads: Lead[] = [];
	// Set when a "Needs attention" name can't be matched to an id in the
	// synced book (see pickFromAttention below) — never left silently unset,
	// because pickExisting() with a blank id would otherwise render exactly
	// like a real selection.
	let attentionUnresolved = '';

	// The synced XPLAN client book (local copy).
	let book: XplanClient[] = [];
	let syncErr = '';

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

	// "9 days ago", not a timestamp. This line exists to prompt a sync, and a
	// dd/mm/yy hh:mm stamp makes the reader do the arithmetic.
	const fmtAge = (iso: string) => {
		const d = new Date(iso);
		if (isNaN(d.getTime())) return '';
		const days = Math.floor((Date.now() - d.getTime()) / 86400000);
		if (days <= 0) return 'today';
		if (days === 1) return 'yesterday';
		return `${days} days ago`;
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
		await reloadBook();
	});

	// The sync runs on axi's worker, not in this tab: leaving the page, or
	// closing the browser, no longer loses it. This function just asks for it.
	const syncBook = async () => {
		syncErr = '';
		await startJob(token(), 'book_sync');
	};

	$: bookJob = runningJob($syncJobs, 'book_sync');
	$: lastBookRun = $syncJobs.last.book_sync;
	$: lastBookSuccess = $syncJobs.lastSuccessAt.book_sync;

	// Reload the book when a run FINISHES. The worker already wrote
	// `xplan_client` server-side, so this is a plain re-read of the store —
	// no merge, no cumulative map, and no browser-side shrink guard. That
	// guard existed because a sweep once returned zero rows and the browser
	// wrote them over a full book; the refusal now lives in data-layer
	// (EMPTY_BOOK) and in the worker, which never sends an empty payload. A
	// second opinion here would only be a place for the two to disagree.
	let seenBookRun = '';
	$: if (lastBookRun && lastBookRun.id !== seenBookRun) {
		seenBookRun = lastBookRun.id;
		void reloadBook();
		// `skipped` is not a failure of the data — it means we did not look.
		// Say which, because the next step differs: sign in vs try again.
		syncErr = lastBookRun.error ?? '';
	}

	const reloadBook = async () => {
		try {
			// The firm-scoped store, not the retired per-user blob: /gw/clients
			// reads xplan_client directly, so the whole synced book is here on
			// load — no manual Sync click needed to see what's already stored.
			//
			// PAGED. One call returns at most the store's 1000-row ceiling, and
			// the book is 4817, so a single request silently delivered a
			// truncated list that looked exactly like a small firm — and left
			// the shrink guard below comparing a full sweep against a fraction
			// of the stored book, which made it stop guarding anything.
			const res = await listAllClients(token());
			book = res.clients.map((c) => ({ id: c.xplanClientId, name: c.name }));
		} catch (e) {
			// GET /gw/clients answers 403 (access tier is Lock), 409 (book never
			// synced) or 502 (contact-layer's _raise_if_store_unavailable — the
			// data-layer/store is unreachable). It never answers 503 — that
			// status only comes from the CDP-touching routes (search-live, PUT
			// /gw/clients/sync), which a page load never calls.
			//
			// "No clients yet" (409) and "could not read the clients we have"
			// (403, 502, anything else) must never render the same message: a
			// planner told to Sync when the real problem is an unreachable store
			// syncs again, gets the same fault, and is no better off.
			if (e instanceof GatewayError && e.status === 409) {
				// The deliberate signal for a firm that has never run a sync, not
				// a fault. Leave book empty; the "not synced yet" affordance below
				// already covers this — it's the correct next step here.
			} else if (e instanceof GatewayError && e.status === 502) {
				// The store itself is unreachable (data-layer down, or a bad
				// service token) — not an empty book. Syncing again will not help.
				syncErr = 'The client store could not be reached. This is not a sync issue — try again shortly.';
			} else if (e instanceof GatewayError && e.status === 403) {
				// Matches the wording already used on the detail page for the
				// same condition.
				syncErr = 'XPLAN access is set to Lock. Switch it to Read-only or Full on Home, then sync.';
			} else {
				// Anything else (including a hypothetical 503 — defensive only;
				// this endpoint cannot produce one today) is a genuine failure.
				// Surface it instead of silently leaving the "not synced yet"
				// message to imply nothing is wrong.
				syncErr =
					e instanceof GatewayError
						? e.message
						: typeof e === 'string'
							? e
							: (e?.message ?? 'Could not load the client book');
				console.warn('client book:', e);
			}
		}
	};

	const pickExisting = (name: string, id = '') => {
		setActiveClient({ id: id || '', name, mode: 'existing', since: nowIso() });
		goto('/apps/clients/detail');
	};

	/**
	 * "Needs attention" names come from the briefing, which carries a name but
	 * no id (see onMount above). Resolving against the already-loaded `book`
	 * gives the honest id for the SAME id space `pickExisting` promises —
	 * both are the synced XPLAN book, so a match here is exactly the client
	 * the row is naming, not a lookalike.
	 *
	 * Finding 3: calling pickExisting(name) with no id used to set an
	 * `existing` client with id: '' — indistinguishable in the bar from a
	 * real selection, while every consumer of linkableClientId silently saw
	 * null. When there is no match (book not yet synced, or the briefing
	 * named someone the book sweep hasn't seen), do NOT set the active
	 * client at all — surface it instead, so the state stays honest.
	 */
	const pickFromAttention = (name: string) => {
		attentionUnresolved = '';
		const match = book.find((c) => c.name === name);
		if (match) {
			pickExisting(match.name, match.id);
			return;
		}
		attentionUnresolved = name;
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
			<!-- Check the source: XPLAN's own client book. -->
			<XplanLink
				path="/factfind/search/result?role=client"
				label="Client list"
				size="md"
				title="Open the client list in XPLAN"
			/>
			{#if bookJob}
				<button
					on:click={() => stopJob(token(), bookJob.id)}
					class="text-xs font-medium text-red-600 hover:text-red-700 px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition"
				>
					Stop
				</button>
			{/if}
			<button
				on:click={syncBook}
				disabled={!!bookJob}
				class="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-850 disabled:opacity-50 transition"
			>
				{#if bookJob}
					{bookJob.status === 'queued' ? 'Queued…' : 'Syncing…'}
				{:else}
					Sync client book
				{/if}
			</button>
		</div>
	</div>

	<!-- Sync status -->
	<p class="text-xs text-gray-400 mb-4">
		{#if bookJob?.progress}
			<span class="text-gray-500">{bookJob.progress}</span>
		{:else if lastBookSuccess}
			<!-- Deliberately the last SUCCESS, not the last run. After a failed
			     sync the book really is still nine days old, and saying "synced
			     just now" because something ran would be a lie the planner acts
			     on. -->
			<span class="text-gray-400">Client book last synced {fmtAge(lastBookSuccess)}</span>
		{:else if book.length === 0}
			<span class="text-gray-400">Not synced yet</span>
		{/if}
		{#if syncErr}
			<span class="text-red-600">{syncErr}</span>
		{/if}
		{#if $syncJobsError}
			<span class="text-amber-600">Can’t reach axi’s job list — {$syncJobsError}</span>
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
			<div class="flex items-baseline justify-between mb-2">
				<h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Recent</h2>
				<!-- Recent is per-browser localStorage, so it outlives a database
				     wipe. Offer the only in-app way to forget it. -->
				<button
					on:click={clearRecentClients}
					class="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:underline transition"
					title="Forget the recently used clients on this browser"
				>
					Clear
				</button>
			</div>
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
			{#if attentionUnresolved}
				<p class="text-xs text-red-600 dark:text-red-400 mb-2">
					Couldn’t match “{attentionUnresolved}” to a client in the synced book — sync the client
					book, or search for them by name above.
				</p>
			{/if}
			<div class="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
				{#each attentionFiltered as name}
					<button on:click={() => pickFromAttention(name)} class="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-850 transition">
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
