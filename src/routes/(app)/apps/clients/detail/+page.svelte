<script lang="ts">
	// Client detail — the planner-facing deep-sync surface (spec §6). Loads a
	// cached ClientDetail instantly, then lets the planner pull a fresh copy of
	// five XPLAN sections (contact/financials/insurance/tasks/notes) on demand.
	// Token-spending: full sync reads 5 pages; per-section Re-sync reads 1.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { activeClient } from '$lib/apps/activeClient';
	import { getOutput, putOutput } from '$lib/apis/gateway';
	import { PLAYBOOK } from '$lib/apis/xplan/playbook';
	import { runOperation, XplanNotLoggedInError, type RawBriefingItem } from '$lib/apis/xplan';
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

	const SECTION_LABELS: Record<ClientSectionName, string> = {
		contact: 'Contact',
		financials: 'Financials',
		insurance: 'Insurance',
		tasks: 'Tasks',
		notes: 'Notes'
	};

	// Column headers for the sections whose data is a flat string[][] table
	// (best-effort order per the catalog's outputSpec — pending Task 13 live
	// verification against the real page).
	const TABLE_HEADERS: Partial<Record<ClientSectionName, string[]>> = {
		financials: ['Description', 'Owner', 'Value', 'Type'],
		insurance: ['Insurer', 'Cover type', 'Sum insured', 'Premium', 'Owner', 'Status'],
		notes: ['Subject', 'Type', 'Date', 'Snippet']
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
	// True ONLY while a full 5-section deep sync (fullSync) is running — gates
	// the "Syncing N/5" counter badge so a per-section Re-sync (which also sets
	// `syncing`) never inflates it past its denominator.
	let fullSyncActive = false;
	let progress = 0; // sections completed in the CURRENT full-sync run only
	let error = '';
	let notLoggedIn = false;

	const ALREADY_RUNNING = 'A sync is already running — try again in a moment.';

	const token = () => localStorage.getItem('token') ?? '';

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

	const deps = () => ({
		run: (opId: string, params: Record<string, string>) => runOperation(PLAYBOOK[opId], token(), params),
		save: async (d: ClientDetail) => {
			detail = { ...d };
			await putOutput(token(), `client:${d.clientId}`, 'client_detail', d);
		},
		onProgress: (section: ClientSectionName, state: 'start' | 'ok' | 'error') => {
			if (state === 'start') syncing = section;
			// Only a full deep sync advances the N/5 counter — a single-section
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
		try {
			await runClientDeepSync(client.id, client.name, deps(), detail ?? undefined);
		} catch (e) {
			if (e instanceof XplanNotLoggedInError) notLoggedIn = true;
			else if (e instanceof Error && /already running/i.test(e.message)) error = ALREADY_RUNNING;
			else error = e instanceof Error ? e.message : String(e);
		} finally {
			syncing = null;
			fullSyncActive = false;
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
		try {
			await resyncSection(detail, section, deps());
		} catch (e) {
			if (e instanceof XplanNotLoggedInError) notLoggedIn = true;
			else if (e instanceof Error && /already running/i.test(e.message)) error = ALREADY_RUNNING;
			else error = e instanceof Error ? e.message : String(e);
		} finally {
			syncing = null;
		}
	};

	onMount(async () => {
		if (!client) {
			goto('/apps/clients');
			return;
		}
		if (hasXplanId) {
			try {
				detail = await getOutput<ClientDetail>(token(), `client:${client.id}`);
			} catch (e) {
				console.warn('client detail:', e);
			}
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

	{#if notLoggedIn}
		<div class="mb-5 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-4 py-3">
			XPLAN not connected — open debug Chrome and sign in
		</div>
	{/if}
	{#if error}
		<div class="mb-5 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-3">
			{error}
		</div>
	{/if}

	{#if !hasXplanId}
		<div class="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 p-8 text-center">
			<p class="text-sm text-gray-500">No XPLAN id for this client</p>
		</div>
	{:else}
		<!-- Full sync -->
		<div class="flex items-center justify-between gap-3 mb-6">
			<button
				on:click={fullSync}
				disabled={busy}
				class="inline-flex items-center gap-2 text-sm font-medium px-3.5 py-2 rounded-xl bg-black text-white dark:bg-white dark:text-black hover:opacity-90 disabled:opacity-50 disabled:cursor-wait transition"
			>
				{#if fullSyncActive}
					<svg class="size-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
					Syncing {progress + 1}/{SECTION_OPS.length} — {syncing ? SECTION_LABELS[syncing] : ''}…
				{:else if busy}
					<svg class="size-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
					Busy…
				{:else}
					{detail && isFresh ? 'Refresh' : 'Sync full details from XPLAN'}
				{/if}
			</button>
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
								{#if c.employment}<dt class="text-gray-400">Employment</dt><dd>{c.employment}</dd>{/if}
								{#if c.partner}<dt class="text-gray-400">Partner</dt><dd>{c.partner}</dd>{/if}
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
	{/if}
</div>
