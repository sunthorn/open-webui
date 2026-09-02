<script lang="ts">
	// Client detail — the planner-facing sync surface.
	//
	// TWO reads live here, deliberately, and the page has to make the
	// difference legible before anyone acts on a number:
	//
	//  1. THE SCRIPTED READ (primary). PUT /gw/clients/{id}/sync runs a fixed,
	//     reviewed script over CDP across all 23 factfind pages and stores the
	//     result in the firm-scoped client store. Seconds, deterministic, no
	//     model call and no tokens. This is what the planner should press.
	//
	//  2. THE AGENT READ (kept). XPLAN does not server-render Tasks — they
	//     arrive via JavaScript the scraper never sees — so the model path is
	//     the ONLY way to read them. It covers six sections, is slower, and
	//     spends tokens. Kept for exactly what the scraper cannot reach.
	//
	// They write to different places on purpose: the scripted read fills the
	// firm-scoped tables (client data belongs to the practice); the agent read
	// still writes the per-user `agent_output` blob at `client:{id}`. The blob
	// stays until every reader has moved off it.
	//
	// Both are READS. Nothing on this page writes to XPLAN.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { activeClient } from '$lib/apps/activeClient';
	import {
		GatewayError,
		deepSyncClient,
		getClientDetail,
		getOutput,
		putOutput,
		type XplanClientRecord,
		type XplanClientSection
	} from '$lib/apis/gateway';
	import { PLAYBOOK } from '$lib/apis/xplan/playbook';
	import {
		runOperation,
		XplanNotLoggedInError,
		XplanCancelledError,
		type RawBriefingItem
	} from '$lib/apis/xplan';
	import type { ClientContact } from '$lib/apis/xplan/playbook';
	import {
		runClientDeepSync,
		resyncSection,
		isDeepSyncActive,
		SECTION_OPS,
		type ClientDetail,
		type ClientSection,
		type ClientSectionName
	} from '$lib/apis/xplan/deepSync';

	const FRESH_DAYS = 7;

	// Display names for the scripted read's sections, mirroring the `label`
	// column of contact-layer/app/pages.py. A section missing from this map is
	// title-cased rather than hidden, so a page added there still renders.
	const STORE_LABELS: Record<string, string> = {
		key_details: 'Key Details',
		habits: 'Personal Habits',
		contact: 'Contact & Demographics',
		employment: 'Employment Details',
		dependants: 'Dependants',
		identity: 'Identity Check',
		domicile: 'Domicile History',
		category: 'Category / Marketing',
		notes: 'File Notes',
		client_report: 'Merge / Client Report',
		cashflow: 'Income & Expenses',
		balancesheet: 'Assets & Liabilities',
		net_value: 'Net Position',
		balance_sheet_custom: 'Balance Sheet',
		budget: 'Budget',
		annuities: 'Annuities',
		super: 'Superannuation',
		estate: 'Estate Details',
		centrelink: 'Centrelink',
		insurance_owner: 'Insurance · By Policy Owner',
		insurance_life: 'Insurance · By Life Insured',
		insurance_medical: 'Insurance · Medical',
		insurance_general: 'Insurance · General'
	};

	const storeLabel = (section: string) =>
		STORE_LABELS[section] ?? section.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

	const SECTION_LABELS: Record<ClientSectionName, string> = {
		contact: 'Contact',
		financials: 'Financials',
		insurance: 'Insurance',
		tasks: 'Tasks',
		notes: 'Notes',
		super: 'Superannuation'
	};

	// Column headers for the sections whose data is a flat string[][] table
	// (best-effort order per the catalog's outputSpec — pending Task 13 live
	// verification against the real page).
	const TABLE_HEADERS: Partial<Record<ClientSectionName, string[]>> = {
		financials: ['Description', 'Owner', 'Value', 'Type'],
		insurance: ['Insurer', 'Cover type', 'Sum insured', 'Premium', 'Owner', 'Status'],
		notes: ['Subject', 'Type', 'Date', 'Snippet'],
		super: ['Fund name', 'Member', 'Balance', 'Type']
	};

	// `detail` is plain LOCAL component state that this page alone owns — never
	// a store. This matters because runClientDeepSync()/resyncSection() (Task
	// 10) MUTATE whatever `base`/`detail` object they're given IN PLACE before
	// returning it. If we aliased $activeClient (a store) or any object another
	// part of the app still reads, those in-place mutations would leak into
	// shared state mid-sync, ahead of any intentional reassignment. Because
	// `detail` here is a private `let` with no other reader, the in-place
	// mutation is harmless — Svelte's reactivity is driven instead by
	// deps.save() below, which reassigns `detail = { ...d }` after every
	// section completes.
	let detail: ClientDetail | null = null;
	// Which section is currently being synced (start of that section's op),
	// cleared in the `finally` of both fullSync/oneSection — always resolves
	// within THIS component, whichever handler is running.
	let syncing: ClientSectionName | null = null;
	// True ONLY while a full 6-section deep sync (fullSync) is running — gates
	// the "Syncing N/6" counter badge (denominator is SECTION_OPS.length, so it
	// tracks the catalog automatically) so a per-section Re-sync (which also
	// sets `syncing`) never inflates it past its denominator.
	let fullSyncActive = false;
	let progress = 0; // sections completed in the CURRENT full-sync run only
	let error = '';
	let notLoggedIn = false;
	// Stop control — aborts the in-flight section read and halts the remaining
	// sections of a full sync.
	let syncCtrl: AbortController | null = null;
	const stopSync = () => syncCtrl?.abort();

	const ALREADY_RUNNING = 'A sync is already running — try again in a moment.';

	const token = () => localStorage.getItem('token') ?? '';

	// --- The scripted read (primary) ---------------------------------------
	// Firm-scoped store: one record + one row per section, filled by
	// PUT /gw/clients/{id}/sync and read back by GET /gw/clients/{id}.
	let storeClient: XplanClientRecord | null = null;
	let sections: XplanClientSection[] = [];
	// null until the first load resolves — "not in the synced book" and "not
	// loaded yet" must not look the same.
	let inBook: boolean | null = null;
	let scriptedRunning = false;
	let scriptedMsg = '';
	let scriptedErr = '';
	// A 503 is the XPLAN session, not a fault in axi. The fix is "sign in
	// again", so it gets its own amber notice rather than a red error.
	let sessionExpired = false;

	const loadStore = async () => {
		if (!client || !hasXplanId) return;
		try {
			const d = await getClientDetail(token(), client.id);
			inBook = d !== null;
			storeClient = d?.client ?? null;
			sections = d?.sections ?? [];
		} catch (e) {
			scriptedErr = e instanceof Error ? e.message : String(e);
		}
	};

	/**
	 * Read all 23 factfind pages with the reviewed script — seconds, no tokens.
	 *
	 * Reads only. The gateway stores each section server-side, so the reload
	 * afterwards is what puts the fresh values on screen.
	 */
	const scriptedSync = async () => {
		if (!client || !hasXplanId || scriptedRunning) return;
		scriptedRunning = true;
		scriptedMsg = '';
		scriptedErr = '';
		sessionExpired = false;
		try {
			const r = await deepSyncClient(token(), client.id);
			await loadStore();
			const parts = [`Read ${r.sectionsRead} pages`, `stored ${r.sectionsStored}`];
			if (r.storeFailures) parts.push(`${r.storeFailures} failed to store`);
			if (r.idsUsed.length > 1) parts.push(`covered the household (${r.idsUsed.join(', ')})`);
			if (r.missingPanels.length)
				parts.push(
					`${r.missingPanels.length} page${r.missingPanels.length === 1 ? '' : 's'} were missing a panel the map expects — check those values`
				);
			scriptedMsg = parts.join(' · ') + '.';
		} catch (e) {
			if (e instanceof GatewayError && e.status === 503) sessionExpired = true;
			else if (e instanceof GatewayError && e.status === 403)
				scriptedErr = 'XPLAN access is set to Lock. Switch it to Read-only or Full on Home, then sync.';
			else if (e instanceof GatewayError && e.status === 404)
				scriptedErr =
					'This client is not in the synced book yet — run “Sync client book” on the Clients page first.';
			else scriptedErr = e instanceof Error ? e.message : String(e);
		} finally {
			scriptedRunning = false;
		}
	};

	// Column order comes from the section's OWN headers; rows are header-keyed
	// objects ({"Description": "Home"}), never positional arrays. Falling back
	// to the first row's keys keeps a section readable if headers came back
	// empty.
	const columns = (s: XplanClientSection) =>
		s.headers?.length ? s.headers : Object.keys(s.rows?.[0] ?? {});

	// 'changed' = XPLAN's page structure moved; 'error' = the read failed.
	// Either way data-layer kept the last good rows, so what is on screen is
	// STALE — which is the one thing a planner must know before acting on a
	// number. 'empty' is a successful read of a page with nothing on it.
	const isStale = (s: XplanClientSection) => s.status === 'changed' || s.status === 'error';

	const staleReason = (s: XplanClientSection) =>
		s.status === 'changed'
			? 'XPLAN’s page structure changed, so this page could not be read into the usual columns. These are the last good values.'
			: 'The last read of this page failed. These are the last good values.';

	const statusChip = (s: XplanClientSection) =>
		({
			ok: { label: 'Current', cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
			empty: { label: 'Nothing recorded', cls: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
			changed: { label: 'Stale · page changed', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
			error: { label: 'Stale · read failed', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' }
		})[s.status];

	$: staleCount = sections.filter(isStale).length;

	$: client = $activeClient;
	// A 'new:'-prefixed id (or mode 'new') means no XPLAN entity id exists yet —
	// there's nothing to deep-sync against.
	$: hasXplanId = !!client && client.mode !== 'new' && !!client.id && !client.id.startsWith('new:');
	$: newestSync = detail
		? Math.max(0, ...Object.values(detail.sections).map((s) => (s?.syncedAt ? +new Date(s.syncedAt) : 0)))
		: 0;
	$: isFresh = newestSync > 0 && newestSync > Date.now() - FRESH_DAYS * 86400000;
	// Deliberately local-only: `isDeepSyncActive()` reads a non-reactive module
	// global, so it can never be part of a Svelte `$:` — if it were, a sync
	// started here, abandoned by navigating away, and left running would strand
	// `busy` at `true` forever in any component instance that re-derives it
	// (nothing ever reassigns a store/prop to re-trigger the statement). `syncing`
	// is plain local state that a FRESH component instance always starts at
	// `null` and that this component's own handlers always clear in `finally` —
	// so it always resolves. Cross-instance/concurrent-sync protection is instead
	// enforced IMPERATIVELY at the top of fullSync/oneSection (see below).
	$: busy = syncing !== null;

	const fmtAge = (iso?: string) => {
		if (!iso) return '';
		const d = new Date(iso);
		const days = Math.floor((Date.now() - d.getTime()) / 86400000);
		if (days <= 0) return 'today';
		if (days === 1) return '1 day ago';
		if (days < 30) return `${days} days ago`;
		return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
	};

	const statusDot = (s?: ClientSection) =>
		!s ? 'bg-gray-300 dark:bg-gray-700' : s.status === 'ok' ? 'bg-green-500' : 'bg-red-500';

	const deps = (signal?: AbortSignal) => ({
		run: (opId: string, params: Record<string, string>) =>
			runOperation(PLAYBOOK[opId], token(), params, fetch, signal),
		save: async (d: ClientDetail) => {
			detail = { ...d };
			await putOutput(token(), `client:${d.clientId}`, 'client_detail', d);
		},
		onProgress: (section: ClientSectionName, state: 'start' | 'ok' | 'error') => {
			if (state === 'start') syncing = section;
			// Only a full deep sync advances the N/6 counter — a single-section
			// Re-sync must never push it past its denominator.
			else if (fullSyncActive) progress += 1;
		}
	});

	// isDeepSyncActive() is checked IMPERATIVELY (not via a reactive `$:`) so a
	// sync left running by another/abandoned component instance is caught right
	// here — surfaced as a friendly message — rather than relying on a
	// non-reactive global to drive `disabled` (see the `busy` comment above).
	const fullSync = async () => {
		if (!client || !hasXplanId) return;
		if (syncing !== null || isDeepSyncActive()) {
			error = ALREADY_RUNNING;
			return;
		}
		error = '';
		notLoggedIn = false;
		progress = 0;
		fullSyncActive = true;
		syncCtrl = new AbortController();
		try {
			await runClientDeepSync(client.id, client.name, deps(syncCtrl.signal), detail ?? undefined, syncCtrl.signal);
		} catch (e) {
			if (e instanceof XplanCancelledError) {
				/* clean stop — partial sections are already saved */
			} else if (e instanceof XplanNotLoggedInError) notLoggedIn = true;
			else if (e instanceof Error && /already running/i.test(e.message)) error = ALREADY_RUNNING;
			else error = e instanceof Error ? e.message : String(e);
		} finally {
			syncing = null;
			fullSyncActive = false;
			syncCtrl = null;
		}
	};

	const oneSection = async (section: ClientSectionName) => {
		if (!detail) return;
		if (syncing !== null || isDeepSyncActive()) {
			error = ALREADY_RUNNING;
			return;
		}
		error = '';
		notLoggedIn = false;
		syncCtrl = new AbortController();
		try {
			await resyncSection(detail, section, deps(syncCtrl.signal), syncCtrl.signal);
		} catch (e) {
			if (e instanceof XplanCancelledError) {
				/* clean stop */
			} else if (e instanceof XplanNotLoggedInError) notLoggedIn = true;
			else if (e instanceof Error && /already running/i.test(e.message)) error = ALREADY_RUNNING;
			else error = e instanceof Error ? e.message : String(e);
		} finally {
			syncing = null;
			syncCtrl = null;
		}
	};

	onMount(async () => {
		if (!client) {
			goto('/apps/clients');
			return;
		}
		if (hasXplanId) {
			// Both stores, in parallel: the firm-scoped sections the scripted
			// read fills, and the legacy per-user blob the agent read still writes.
			await Promise.all([
				loadStore(),
				(async () => {
					try {
						detail = await getOutput<ClientDetail>(token(), `client:${client.id}`);
					} catch (e) {
						console.warn('client detail:', e);
					}
				})()
			]);
		}
	});
</script>

<div class="max-w-3xl mx-auto px-8 py-10">
	<!-- Header -->
	<div class="flex items-start justify-between gap-4 mb-6">
		<div class="min-w-0">
			<h1 class="text-2xl font-semibold tracking-tight truncate">{client?.name ?? 'Client'}</h1>
			<p class="text-sm text-gray-500 mt-1">
				{#if hasXplanId}XPLAN id {client?.id}{:else}No XPLAN id yet{/if}
			</p>
		</div>
		<a
			href="/apps/data-entry"
			class="shrink-0 text-sm font-medium text-gray-500 hover:text-black dark:hover:text-white transition"
		>
			Data Entry →
		</a>
	</div>

	{#if !hasXplanId}
		<div class="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 p-8 text-center">
			<p class="text-sm text-gray-500">No XPLAN id for this client</p>
		</div>
	{:else}
		<!-- ===== 1. The scripted read — the primary action ==================
		     23 pages, seconds, no AI credits. Deterministic, so this is what
		     the planner should reach for; the AI path below exists only for
		     what a scraper cannot see. -->
		<section class="mb-8">
			<div class="flex items-start justify-between gap-3 mb-3">
				<div class="min-w-0">
					<h2 class="text-sm font-semibold">XPLAN factfind</h2>
					<p class="text-xs text-gray-500 mt-0.5">
						All 23 factfind pages, read by script. Seconds, exact, no AI credits.
					</p>
				</div>
				<button
					on:click={scriptedSync}
					disabled={scriptedRunning}
					class="shrink-0 inline-flex items-center gap-2 text-sm font-medium px-3.5 py-2 rounded-xl bg-black text-white dark:bg-white dark:text-black hover:opacity-90 disabled:opacity-50 disabled:cursor-wait transition"
				>
					{#if scriptedRunning}
						<svg class="size-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
						Reading 23 pages…
					{:else}
						{sections.length ? 'Re-read from XPLAN' : 'Read from XPLAN'}
					{/if}
				</button>
			</div>

			{#if sessionExpired}
				<div class="mb-3 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-4 py-3">
					XPLAN signed you out (or the debug Chrome isn’t reachable). Sign in again in the
					debug browser, then press Read from XPLAN — nothing is wrong with axi.
				</div>
			{/if}
			{#if scriptedErr}
				<div class="mb-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-3">
					{scriptedErr}
				</div>
			{/if}
			{#if scriptedMsg}
				<p class="mb-3 text-xs text-gray-500">{scriptedMsg}</p>
			{/if}

			{#if staleCount}
				<div class="mb-3 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-4 py-3">
					{staleCount} section{staleCount === 1 ? ' is' : 's are'} showing last-good values, not a fresh
					read. Check those before acting on the numbers.
				</div>
			{/if}

			{#if sections.length}
				<p class="text-xs text-gray-400 mb-2">
					{sections.length} sections{storeClient?.deepSyncedAt
						? ` · last read ${fmtAge(storeClient.deepSyncedAt)}`
						: ''}
				</p>
				<div class="space-y-2">
					{#each sections as s (s.section + s.fetchedViaId)}
						{@const cols = columns(s)}
						<details class="rounded-2xl border border-gray-100 dark:border-gray-800" open={isStale(s)}>
							<summary class="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none">
								<span class="text-sm font-medium flex-1 min-w-0 truncate">{storeLabel(s.section)}</span>
								{#if s.rows?.length}
									<span class="text-xs text-gray-400 tabular-nums">{s.rows.length} rows</span>
								{/if}
								<span class="text-[10px] px-1.5 py-0.5 rounded-full {statusChip(s).cls}">
									{statusChip(s).label}
								</span>
							</summary>
							<div class="px-4 pb-4">
								{#if isStale(s)}
									<p class="text-xs text-amber-700 dark:text-amber-400 mb-2">
										{staleReason(s)} Last read {fmtAge(s.fetchedAt)}.
									</p>
								{/if}
								{#if cols.length && s.rows?.length}
									<div class="overflow-x-auto -mx-1">
										<table class="w-full text-sm border-collapse">
											<thead>
												<tr class="text-left text-xs text-gray-400 uppercase tracking-wide">
													{#each cols as h}
														<th class="px-1 py-1.5 font-semibold whitespace-nowrap">{h}</th>
													{/each}
												</tr>
											</thead>
											<tbody class="divide-y divide-gray-100 dark:divide-gray-800">
												{#each s.rows as row}
													<tr>
														{#each cols as h}
															<td class="px-1 py-1.5 align-top">{row[h] ?? ''}</td>
														{/each}
													</tr>
												{/each}
											</tbody>
										</table>
									</div>
								{:else}
									<p class="text-sm text-gray-500">Nothing recorded on this page in XPLAN.</p>
								{/if}
								<p class="text-[10px] text-gray-400 mt-2">
									page {s.pageId} · read via id {s.fetchedViaId}{s.mapVersion
										? ` · map v${s.mapVersion}`
										: ' · no verified map yet'}
								</p>
							</div>
						</details>
					{/each}
				</div>
			{:else if inBook === false}
				<div class="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 px-4 py-5 text-center">
					<p class="text-sm text-gray-500">
						This client isn’t in the synced book yet. Run <span class="font-medium">Sync client book</span>
						on the Clients page, then read from XPLAN here.
					</p>
				</div>
			{:else if inBook}
				<div class="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 px-4 py-5 text-center">
					<p class="text-sm text-gray-500">
						No factfind pages read yet — press <span class="font-medium">Read from XPLAN</span>.
					</p>
				</div>
			{/if}
		</section>

		<!-- ===== 2. The AI read — kept for what the script cannot see =======
		     XPLAN does not server-render Tasks, so the scripted read above
		     genuinely cannot see them. This path can: it is slower, spends
		     tokens, and covers six sections. Labelled so nobody reaches for it
		     by mistake. -->
		<section class="border-t border-gray-100 dark:border-gray-800 pt-6">
			<h2 class="text-sm font-semibold">AI read · Tasks and five other sections</h2>
			<p class="text-xs text-gray-500 mt-0.5 mb-3">
				Slower and spends AI credits. Worth it for <span class="font-medium">Tasks</span>, which XPLAN
				builds in the browser and the scripted read above cannot see.
			</p>

			<!-- These two belong to the AI path only (fullSync/oneSection set
			     them), so they live inside this section — at the top of the page
			     they read as a fault in the scripted read above, which they
			     never are. -->
			{#if notLoggedIn}
				<div class="mb-3 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-4 py-3">
					XPLAN not connected — open debug Chrome and sign in
				</div>
			{/if}
			{#if error}
				<div class="mb-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-3">
					{error}
				</div>
			{/if}

		<!-- Full sync -->
		<div class="flex items-center justify-between gap-3 mb-6">
			<div class="flex items-center gap-2">
			<button
				on:click={fullSync}
				disabled={busy}
				class="inline-flex items-center gap-2 text-sm font-medium px-3.5 py-2 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-850 disabled:opacity-50 disabled:cursor-wait transition"
			>
				{#if fullSyncActive}
					<svg class="size-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
					Reading {progress + 1}/{SECTION_OPS.length} — {syncing ? SECTION_LABELS[syncing] : ''}…
				{:else if busy}
					<svg class="size-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
					Busy…
				{:else}
					{detail && isFresh ? 'Re-read with the AI' : 'Read 6 sections with the AI'}
				{/if}
			</button>
			{#if busy}
				<button
					on:click={stopSync}
					class="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-xl border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition"
				>
					<span class="size-2 rounded-[2px] bg-red-500"></span>
					Stop
				</button>
			{/if}
			</div>
			{#if detail}
				<span class="text-xs text-gray-400">Newest section {fmtAge(new Date(newestSync).toISOString())}</span>
			{/if}
		</div>

		<!-- Section cards -->
		<div class="space-y-4">
			{#each SECTION_OPS as [section] (section)}
				{@const s = detail?.sections[section]}
				<div class="rounded-2xl border border-gray-100 dark:border-gray-800 p-5">
					<div class="flex items-center justify-between gap-3 mb-3">
						<div class="flex items-center gap-2.5">
							<span class="size-2 rounded-full shrink-0 {statusDot(s)}"></span>
							<h2 class="text-sm font-semibold">{SECTION_LABELS[section]}</h2>
							<span class="text-xs text-gray-400">{s ? fmtAge(s.syncedAt) : 'Not synced'}</span>
						</div>
						<button
							on:click={() => oneSection(section)}
							disabled={busy || !detail}
							class="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-850 disabled:opacity-50 disabled:cursor-wait transition"
						>
							{#if syncing === section && !fullSyncActive}
								<svg class="size-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
								Re-syncing…
							{:else}
								Re-sync
							{/if}
						</button>
					</div>

					{#if s?.status === 'error'}
						<p class="text-sm text-red-500">Last sync failed for this section.</p>
					{:else if s?.status === 'ok'}
						{#if section === 'contact'}
							{@const c = s.data as ClientContact}
							<dl class="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
								<dt class="text-gray-400">Name</dt><dd>{c.name || '—'}</dd>
								{#if c.preferredName}<dt class="text-gray-400">Preferred name</dt><dd>{c.preferredName}</dd>{/if}
								{#if c.dob}<dt class="text-gray-400">Date of birth</dt><dd>{c.dob}</dd>{/if}
								{#if c.address}<dt class="text-gray-400">Address</dt><dd>{c.address}</dd>{/if}
								<dt class="text-gray-400">Phones</dt><dd>{c.phones.length ? c.phones.join(', ') : '—'}</dd>
								<dt class="text-gray-400">Emails</dt><dd>{c.emails.length ? c.emails.join(', ') : '—'}</dd>
								{#if c.partner}<dt class="text-gray-400">Partner</dt><dd>{c.partner}</dd>{/if}
								{#if c.partnerAddress}<dt class="text-gray-400">Partner address</dt><dd>{c.partnerAddress}</dd>{/if}
								{#if c.partnerPhones?.length}<dt class="text-gray-400">Partner phones</dt><dd>{c.partnerPhones.join(', ')}</dd>{/if}
								{#if c.partnerEmails?.length}<dt class="text-gray-400">Partner emails</dt><dd>{c.partnerEmails.join(', ')}</dd>{/if}
							</dl>
						{:else if section === 'tasks'}
							{@const items = (s.data as RawBriefingItem[]) ?? []}
							{#if items.length}
								<ul class="space-y-1.5">
									{#each items as it}
										<li class="flex items-center gap-2.5 text-sm">
											<span class="flex-1 min-w-0 truncate {it.done ? 'line-through text-gray-400' : ''}">{it.title}</span>
											{#if it.dueAt}<span class="text-xs text-gray-400 tabular-nums">{it.dueAt}</span>{/if}
										</li>
									{/each}
								</ul>
							{:else}
								<p class="text-sm text-gray-500">No tasks found.</p>
							{/if}
						{:else}
							{@const rows = (s.data as string[][]) ?? []}
							{#if rows.length}
								<div class="overflow-x-auto -mx-1">
									<table class="w-full text-sm border-collapse">
										{#if TABLE_HEADERS[section]}
											<thead>
												<tr class="text-left text-xs text-gray-400 uppercase tracking-wide">
													{#each TABLE_HEADERS[section] ?? [] as h}
														<th class="px-1 py-1.5 font-semibold">{h}</th>
													{/each}
												</tr>
											</thead>
										{/if}
										<tbody class="divide-y divide-gray-100 dark:divide-gray-800">
											{#each rows as row}
												<tr>
													{#each row as cell}
														<td class="px-1 py-1.5 align-top">{cell}</td>
													{/each}
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							{:else}
								<p class="text-sm text-gray-500">None found.</p>
							{/if}
						{/if}
					{:else}
						<p class="text-sm text-gray-400">Not synced yet.</p>
					{/if}
				</div>
			{/each}
		</div>
		</section>
	{/if}
</div>
