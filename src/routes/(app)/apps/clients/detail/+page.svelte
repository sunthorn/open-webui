<script lang="ts">
	// Client detail — the planner-facing sync surface.
	//
	// ONE read lives here. PUT /gw/clients/{id}/sync runs a fixed, reviewed
	// script over CDP across the 23 factfind pages, then the firm's to-do list
	// filtered to this client, and stores each as a section in the firm-scoped
	// client store. Seconds, deterministic, no model call, no tokens.
	//
	// The agent read that used to sit below it (six sections via hermes,
	// `agent_output` key `client:{id}`) is gone from this page: five of its six
	// sections were the same factfind pages read worse, and the sixth — Tasks —
	// is now read by script from /xtasks/list. The playbook ops still exist
	// ($lib/apis/xplan/playbook.ts) for anything that wants them.
	//
	// Layout: sticky header (who, how fresh, the one button), a grouped rail
	// of all 24 sections, and a pane showing the selected one. The rail and
	// pane are dumb components; grouping and "which section first" live in
	// $lib/apps/clientSections.ts where they are unit-tested.
	//
	// This is a READ. Nothing on this page writes to XPLAN.
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { goto, replaceState } from '$app/navigation';
	import { activeClient } from '$lib/apps/activeClient';
	import { getClientDetail, type XplanClientRecord, type XplanClientSection } from '$lib/apis/gateway';
	import { syncJobs, syncJobsError, startJob, stopJob, runningJob } from '$lib/stores/syncJobs';
	import { groupSections, defaultSection } from '$lib/apps/clientSections';
	import ClientSectionRail from '$lib/components/apps/ClientSectionRail.svelte';
	import ClientSectionPane from '$lib/components/apps/ClientSectionPane.svelte';

	const token = () => localStorage.getItem('token') ?? '';

	// Firm-scoped store: one record + one row per section per id it was
	// fetched via, filled by PUT /gw/clients/{id}/sync and read back by
	// GET /gw/clients/{id}.
	let storeClient: XplanClientRecord | null = null;
	let sections: XplanClientSection[] = [];
	// null until the first load resolves — "not in the synced book" and "not
	// loaded yet" must not look the same.
	let inBook: boolean | null = null;
	let scriptedMsg = '';
	let scriptedErr = '';
	// A 503 is the XPLAN session, not a fault in axi. The fix is "sign in
	// again", so it gets its own amber notice rather than a red error.
	let sessionExpired = false;
	// Tracked so the sticky rail can sit just below the sticky header instead
	// of sliding under it (both are `sticky`, and the header sits on top).
	let headerH = 0;

	// The rail's selection. Mirrored to the URL hash so a link can land on a
	// section; the hash wins over the default when it names a section we have.
	let selected: string | null = null;

	const loadStore = async () => {
		if (!client || !hasXplanId) return;
		try {
			const d = await getClientDetail(token(), client.id);
			inBook = d !== null;
			storeClient = d?.client ?? null;
			sections = d?.sections ?? [];
			if (!selected || !sections.some((s) => s.section === selected)) {
				selected = defaultSection(sections, location.hash);
			}
		} catch (e) {
			scriptedErr = e instanceof Error ? e.message : String(e);
		}
	};

	const select = (section: string) => {
		selected = section;
		replaceState(`#${section}`, {});
	};

	/**
	 * Read all 23 factfind pages plus open tasks with the reviewed script —
	 * seconds, no tokens. Reads only. The gateway stores each section
	 * server-side, so the reload afterwards is what puts the fresh values on
	 * screen.
	 */
	const scriptedSync = async () => {
		if (!client || !hasXplanId) return;
		scriptedMsg = '';
		scriptedErr = '';
		sessionExpired = false;
		const started = await startJob(token(), 'deep_sync', { clientId: client.id });
		if (!started) scriptedErr = get(syncJobsError) ?? 'Could not start the read.';
	};

	$: deepJob = client ? runningJob($syncJobs, 'deep_sync', client.id) : undefined;
	$: lastDeepRun = $syncJobs.last.deep_sync;

	// When a run for THIS client finishes, re-read the store. The worker wrote
	// the sections server-side; loadStore() is what puts them on screen.
	let seenDeepRun = '';
	$: if (
		lastDeepRun &&
		lastDeepRun.id !== seenDeepRun &&
		lastDeepRun.params?.clientId === client?.id
	) {
		seenDeepRun = lastDeepRun.id;
		void loadStore();
		if (lastDeepRun.status === 'done') {
			scriptedMsg = 'Read every scripted page and the open tasks.';
		} else if (lastDeepRun.status === 'skipped') {
			// "We did not look" — the fix is signing in or unlocking access,
			// never re-running against the same closed door.
			sessionExpired = /sign in/i.test(lastDeepRun.error ?? '');
			if (!sessionExpired) scriptedErr = lastDeepRun.error ?? 'XPLAN access is locked.';
		} else if (lastDeepRun.status === 'error') {
			scriptedErr =
				lastDeepRun.error === 'client not in the synced book'
					? 'This client is not in the synced book yet — run “Sync client book” on the Clients page first.'
					: (lastDeepRun.error ?? 'The sync failed.');
		} else if (lastDeepRun.status === 'cancelled') {
			scriptedMsg = lastDeepRun.error ?? 'Stopped. Whatever was read is saved.';
		}
	}

	$: client = $activeClient;
	// A 'new:'-prefixed id (or mode 'new') means no XPLAN entity id exists yet —
	// there's nothing to read against.
	$: hasXplanId = !!client && client.mode !== 'new' && !!client.id && !client.id.startsWith('new:');

	$: groups = groupSections(sections);
	$: selectedRows = selected ? sections.filter((s) => s.section === selected) : [];
	// Counts are per SECTION, not per row: a couple's stale page is one stale
	// section, not two.
	$: staleCount = groups.flatMap((g) => g.entries).filter((e) => e.dot === 'stale' || e.dot === 'error').length;
	$: emptyCount = groups.flatMap((g) => g.entries).filter((e) => e.dot === 'empty' && e.read).length;
	$: sectionCount = new Set(sections.map((s) => s.section)).size;

	const fmtAge = (iso?: string) => {
		if (!iso) return '';
		const d = new Date(iso);
		const days = Math.floor((Date.now() - d.getTime()) / 86400000);
		if (days <= 0) return 'today';
		if (days === 1) return '1 day ago';
		if (days < 30) return `${days} days ago`;
		return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
	};

	onMount(async () => {
		if (!client) {
			goto('/apps/clients');
			return;
		}
		if (hasXplanId) await loadStore();
	});
</script>

<div class="max-w-5xl mx-auto px-6 md:px-8 py-6">
	<!-- Sticky header: who, how fresh, the one button. -->
	<header
		class="sticky top-0 z-10 -mx-6 md:-mx-8 px-6 md:px-8 pt-2 pb-3 mb-5 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800"
		bind:clientHeight={headerH}
	>
		<div class="flex items-start justify-between gap-4">
			<div class="min-w-0">
				<h1 class="text-xl font-semibold tracking-tight truncate">{client?.name ?? 'Client'}</h1>
				<p class="text-xs text-gray-500 mt-0.5">
					{#if hasXplanId}
						XPLAN id {client?.id}
						{#if storeClient?.deepSyncedAt} · last read {fmtAge(storeClient.deepSyncedAt)}{/if}
						{#if sectionCount} · {sectionCount} sections{/if}
						{#if staleCount} · <span class="text-amber-600 dark:text-amber-400">{staleCount} stale</span>{/if}
						{#if emptyCount} · {emptyCount} empty{/if}
					{:else}
						No XPLAN id yet
					{/if}
				</p>
			</div>
			<div class="flex items-center gap-2 shrink-0">
				{#if hasXplanId}
					<button
						on:click={scriptedSync}
						disabled={!!deepJob}
						title="23 factfind pages plus open tasks, read by script. Seconds, exact, no AI credits."
						class="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-850 disabled:opacity-50 transition"
					>
						{#if deepJob}
							{deepJob.status === 'queued' ? 'Queued…' : 'Reading…'}
						{:else}
							{sections.length ? 'Re-read from XPLAN' : 'Read from XPLAN'}
						{/if}
					</button>
					{#if deepJob}
						<button
							on:click={() => stopJob(token(), deepJob.id)}
							class="text-xs font-medium text-red-600 hover:text-red-700 px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition"
						>
							Stop
						</button>
					{/if}
				{/if}
				<a
					href="/apps/data-entry"
					class="text-xs font-medium text-gray-500 hover:text-black dark:hover:text-white transition"
				>
					Data Entry →
				</a>
			</div>
		</div>
		{#if deepJob?.progress}
			<p class="text-xs text-gray-500 mt-1">{deepJob.progress}</p>
		{/if}
	</header>

	{#if !hasXplanId}
		<div class="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 p-8 text-center">
			<p class="text-sm text-gray-500">No XPLAN id for this client</p>
		</div>
	{:else}
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
		{#if staleCount > 0}
			<div class="mb-3 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-4 py-3">
				{staleCount} section{staleCount === 1 ? ' is' : 's are'} showing last-good values, not a fresh
				read. Check those before acting on the numbers.
			</div>
		{/if}

		{#if sections.length}
			<div class="md:flex md:gap-6 md:items-start">
				<ClientSectionRail
					{groups}
					{selected}
					offsetTop={headerH + 16}
					on:select={(e) => select(e.detail)}
				/>
				<ClientSectionPane section={selected} rows={selectedRows} {fmtAge} />
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
					No pages read yet — press <span class="font-medium">Read from XPLAN</span>.
				</p>
			</div>
		{/if}
	{/if}
</div>
