<script lang="ts">
	// Clients — the hub for choosing who the planner works on.
	// Model: SYNC the XPLAN client book into axi (manual "Sync client book"),
	// then search it LOCALLY (instant, free). Also quick-pick Recent, Needs-
	// attention (from the briefing), and New leads. Selecting sets the global
	// active client. See docs/xplan-integration-plan.md.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		GatewayError,
		getBriefing,
		listAllClients,
		type XplanEntityStatus,
		type XplanEntityType
	} from '$lib/apis/gateway';
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
	// XplanClient is the agent-search shape ({name, id}); the synced book also
	// carries an entity status, which must be shown — most of the book is not
	// active clients.
	let book: (XplanClient & {
		status: XplanEntityStatus | null;
		type: XplanEntityType | null;
	})[] = [];
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
			book = res.clients.map((c) => ({
				id: c.xplanClientId,
				name: c.name,
				status: c.entityStatus ?? null,
				type: c.entityType ?? null
			}));
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
	// A row with no status is bucketed as 'unknown' rather than assumed to be a
	// client — the whole point of the label is that an unqualified row must not
	// read as an active client.
	const statusKey = (s: XplanEntityStatus | null): string => s ?? 'unknown';

	const STATUS_LABEL: Record<string, string> = {
		client: 'Clients',
		prospect: 'Prospect',
		group_plan_member: 'Group plan',
		archived: 'Archived',
		deceased: 'Deceased',
		unknown: 'Unknown'
	};
	// Filter order, worst-news last. Only statuses the book actually contains
	// are offered, so a firm with no deceased records never sees a dead tickbox.
	const STATUS_ORDER = ['client', 'prospect', 'group_plan_member', 'archived', 'deceased', 'unknown'];

	// Deceased and archived read as warnings, not neutral metadata: acting on a
	// deceased client is the mistake this badge exists to prevent. An ordinary
	// client gets no badge — 759 of them, and a label on every row is noise that
	// makes the exceptions harder to spot, not easier.
	const STATUS_CLASS: Record<string, string> = {
		deceased: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
		archived: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
		prospect: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
		group_plan_member: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
		unknown: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500'
	};
	const statusBadge = (s: XplanEntityStatus | null) => {
		// 'client', and null for rows synced before the status existed.
		const k = s ?? '';
		return STATUS_CLASS[k] ? { label: STATUS_LABEL[k], class: STATUS_CLASS[k] } : null;
	};

	const TYPE_LABEL: Record<string, string> = {
		individual: 'Individual',
		company: 'Company',
		trust: 'Trust',
		superfund: 'Superfund',
		partnership: 'Partnership',
		unknown: 'Unknown'
	};
	const TYPE_ORDER = ['individual', 'company', 'trust', 'superfund', 'partnership', 'unknown'];

	// Both filters track what is EXCLUDED, so the default (empty) shows
	// everything and a value we have never seen appears rather than being
	// silently filtered out.
	let hiddenStatuses = new Set<string>();
	let hiddenTypes = new Set<string>();
	let openFilter: 'status' | 'type' | null = null;
	let filtersRoot: HTMLElement;

	// `rows` is a parameter, not a closure over `book`, and both call sites pass
	// `book` explicitly. That is load-bearing: Svelte derives a reactive
	// statement's dependencies from the identifiers IN the statement, so a
	// helper that reads `book` from its own scope leaves `book` untracked —
	// these counts were computed once against an empty book and never again,
	// which left every filter with zero options and no dropdown to open.
	const countBy = (rows: typeof book, get: (c: (typeof book)[number]) => string) =>
		rows.reduce<Record<string, number>>((acc, c) => {
			const k = get(c);
			acc[k] = (acc[k] ?? 0) + 1;
			return acc;
		}, {});

	$: statusCounts = countBy(book, (c) => statusKey(c.status));
	$: typeCounts = countBy(book, (c) => c.type ?? 'unknown');
	// Every value XPLAN offers stays listed even at zero, greyed out rather than
	// dropped: "Deceased 0" is an answer, and a control whose options appear and
	// disappear with the data makes the reader wonder what else is missing.
	// `unknown` is the exception — it is our fallback, not an XPLAN choice, so it
	// only appears once something has actually landed in it.
	$: statusOptions = STATUS_ORDER.filter((s) => s !== 'unknown' || statusCounts[s]);
	$: typeOptions = TYPE_ORDER.filter((t) => t !== 'unknown' || typeCounts[t]);

	$: filterMenus = [
		{
			key: 'status' as const,
			label: 'Status',
			options: statusOptions,
			hidden: hiddenStatuses,
			counts: statusCounts,
			labels: STATUS_LABEL
		},
		{
			key: 'type' as const,
			label: 'Type',
			options: typeOptions,
			hidden: hiddenTypes,
			counts: typeCounts,
			labels: TYPE_LABEL
		}
	];

	// What the button face says. "All" / "Clients" / "2 of 3" reads as a control
	// with a current value; a bare "Status ▾" reads as a heading.
	const summarise = (
		options: string[],
		hidden: Set<string>,
		counts: Record<string, number>,
		labels: Record<string, string>
	) => {
		// An empty bucket is neither shown nor hidden — it has nothing to show.
		const available = options.filter((o) => counts[o]);
		const shown = available.filter((o) => !hidden.has(o));
		if (!available.length) return '—';
		if (shown.length === available.length) return 'All';
		if (!shown.length) return 'None';
		if (shown.length === 1) return labels[shown[0]];
		return `${shown.length} of ${available.length}`;
	};

	const toggle = (set: Set<string>, k: string) => {
		// Reassign, not mutate: Svelte does not track Set mutation.
		const next = new Set(set);
		next.has(k) ? next.delete(k) : next.add(k);
		// The browse window is a count, not a cursor — leaving it where it was
		// after the list underneath changed size shows an arbitrary slice.
		browseLimit = BROWSE_STEP;
		return next;
	};

	// Show the synced book: when searching, show ALL matches; when browsing, show
	// a growing window (browseLimit) with a "Show more" control so the planner can
	// page through the whole book instead of being capped at 50.
	const BROWSE_STEP = 50;
	let browseLimit = BROWSE_STEP;
	// The filters apply to searching as well as browsing: hiding Archived and
	// then finding an archived person by name would make the filter a lie.
	$: bookMatches = book.filter(
		(c) =>
			!hiddenStatuses.has(statusKey(c.status)) &&
			!hiddenTypes.has(c.type ?? 'unknown') &&
			(!q || c.name.toLowerCase().includes(q))
	);
	$: bookFiltered = q ? bookMatches : bookMatches.slice(0, browseLimit);
	$: recentFiltered = $recentClients.filter((c) => !q || c.name.toLowerCase().includes(q));
	$: attentionFiltered = attention.filter((n) => !q || n.toLowerCase().includes(q));
	$: openLeads = leads.filter((l) => l.stage === 'enquiry');
</script>

<!--
	Always attached rather than bound on open: the toggle button lives inside
	statusRoot, so the click that opens the panel is inside it and cannot close
	it again on the same event.
-->
<svelte:window
	on:click={(e) => {
		if (openFilter && filtersRoot && !filtersRoot.contains(e.target as Node)) openFilter = null;
	}}
/>

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
				<p class="text-sm text-gray-500">No new leads yet. Type a new client’s name in the search box below to create one.</p>
			</div>
		{/if}
	</section>

	<!-- Search + filters. Sits directly above the list it acts on: both the
	     filters and the box narrow the same book, and putting them at the top
	     of the page separated them from the only thing they change. -->
	<div class="mt-6 mb-3">
		<!-- Mirrors XPLAN's own Search Filter, which offers these same two tick
		     lists over the same book. -->
		<div class="flex items-center gap-2 mb-2" bind:this={filtersRoot}>
			{#each filterMenus as f}
				<div class="relative">
					<button
						on:click={() => (openFilter = openFilter === f.key ? null : f.key)}
						class="flex items-center gap-2 text-sm px-3 py-2 rounded-xl border bg-white dark:bg-gray-900 transition {f.hidden
							.size
							? 'border-gray-800 dark:border-gray-300 text-gray-900 dark:text-gray-100'
							: 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'} hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-850"
					>
						<span class="text-gray-400">{f.label}</span>
						<span class="font-medium">{summarise(f.options, f.hidden, f.counts, f.labels)}</span>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 24 24"
							stroke-width="2"
							stroke="currentColor"
							class="size-4 text-gray-400 transition-transform {openFilter === f.key ? 'rotate-180' : ''}"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
						</svg>
					</button>
					{#if openFilter === f.key}
						<div
							class="absolute left-0 mt-1 z-20 min-w-56 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl py-1"
						>
							{#each f.options as o}
								{@const empty = !f.counts[o]}
								<button
									disabled={empty}
									title={empty ? `No ${f.labels[o].toLowerCase()} in the synced book` : ''}
									on:click={() =>
										f.key === 'status'
											? (hiddenStatuses = toggle(hiddenStatuses, o))
											: (hiddenTypes = toggle(hiddenTypes, o))}
									class="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition {empty
										? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
										: 'hover:bg-gray-50 dark:hover:bg-gray-850'}"
								>
									<input
										type="checkbox"
										checked={!empty && !f.hidden.has(o)}
										disabled={empty}
										tabindex="-1"
										class="pointer-events-none size-4"
									/>
									<span class="flex-1">{f.labels[o]}</span>
									<span class="tabular-nums {empty ? '' : 'text-gray-400'}">{f.counts[o] ?? 0}</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>
		<div class="relative">
			<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor" class="size-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
				<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
			</svg>
			<input
				bind:value={query}
				placeholder="Search by client name, or type a new client’s name…"
				class="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 pl-11 pr-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10"
			/>
		</div>
	</div>

	<!-- Create-new affordance. Moved with the search box, not left at the top:
	     it echoes what was typed, and stranding it away from the input made it
	     read as an unrelated action. -->
	{#if q}
		<button
			on:click={createNew}
			class="w-full flex items-center gap-3 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 px-4 py-3 text-sm hover:bg-gray-50 dark:hover:bg-gray-850 transition mb-6"
		>
			<span class="size-8 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 flex items-center justify-center text-lg leading-none shrink-0">+</span>
			<span>Create new client “<span class="font-medium">{query.trim()}</span>” → start a New Enquiry</span>
		</button>
	{/if}

	<!-- Your clients (synced book): browse at the bottom; filters when searching -->
	{#if bookFiltered.length}
		<section class="mt-6">
			<h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
				{q ? 'Clients' : 'Your clients'} · {q
					? bookFiltered.length
					: `${bookFiltered.length} of ${bookMatches.length}`}{hiddenStatuses.size ||
				hiddenTypes.size
					? ` · filtered from ${book.length}`
					: ''}{lastBookSuccess ? ` · Client book last synced ${fmtAge(lastBookSuccess)}` : ''}
			</h2>
			<div class="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden max-h-96 overflow-y-auto">
				{#each bookFiltered as c}
					<button on:click={() => pickExisting(c.name, c.id)} class="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-850 transition">
						<span class="size-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs font-semibold shrink-0">{c.name.slice(0, 1).toUpperCase()}</span>
						<span class="flex-1 min-w-0 truncate">{c.name}</span>
						{#if statusBadge(c.status)}
							<span class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 {statusBadge(c.status)?.class}">
								{statusBadge(c.status)?.label}
							</span>
						{/if}
						{#if c.id}<span class="text-[10px] text-gray-400 tabular-nums">id {c.id}</span>{/if}
					</button>
				{/each}
			</div>
			{#if !q && browseLimit < bookMatches.length}
				<button
					on:click={() => (browseLimit += BROWSE_STEP)}
					class="mt-2 w-full text-xs font-medium text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 rounded-lg border border-gray-200 dark:border-gray-800 py-2 hover:bg-gray-50 dark:hover:bg-gray-850 transition"
				>
					Show more · {Math.min(BROWSE_STEP, bookMatches.length - browseLimit)} of {bookMatches.length -
						browseLimit} remaining
				</button>
			{/if}
		</section>
	{:else if q && book.length}
		<div class="mt-6 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 px-4 py-4 text-center text-sm text-gray-500">
			No synced client matched “{query.trim()}”. Create a new client above, or re-sync the book.
		</div>
	{/if}
</div>
