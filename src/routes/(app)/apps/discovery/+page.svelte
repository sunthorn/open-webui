<script lang="ts">
	// Stage 2 · Discovery Meeting — understand the client.
	//
	// One button: "Analyse what we have" runs onb_analyse (contact-layer), which
	// reads everything axi holds about the client and writes findings,
	// confidence and open questions onto the four discovery.* actions. The
	// planner adds notes and ticks each row done; Re-analyse shows what is new
	// since the last run. State lives in data-layer per client (Plan 3).
	//
	// The client bar switches the active client WITHOUT remounting this page,
	// so the page reloads on a switch and every handler acts on the client it
	// LOADED (state.lead.xplanClientId), never the live store (amendment B2).
	// A note's debounced save carries the id captured at the keystroke, and a
	// switch flushes pending saves to THAT client before showing the next.
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { activeClient, linkableClientId } from '$lib/apps/activeClient';
	import {
		getOnboarding,
		runAction,
		setAction,
		setStage,
		type OnboardingAction,
		type OnboardingState,
		type Step
	} from '$lib/apis/gateway/onboarding';
	import { STAGE_LABEL, STAGE_PAGE, actionMessage, byStep, doneCount, errorOf } from '$lib/apps/onboarding';
	import {
		DISCOVERY_STEPS,
		analyseJobs,
		analyseOutcome,
		analysisOf,
		changedCount,
		confidenceClass,
		confidenceLabel,
		discoveryDone,
		lastRunAt,
		mergeNoteDrafts,
		newSinceLastRun,
		notesToKeep,
		previousOf,
		skippedStores,
		stageAtLeast,
		stepId
	} from '$lib/apps/discovery';
	import { rowsFor } from '$lib/apps/onboardingRows';
	import { syncJobs, syncJobsError, refreshJobs, startJobPolling } from '$lib/stores/syncJobs';
	import XplanLink from '$lib/components/xplan/XplanLink.svelte';

	const ROWS = rowsFor('discovery');

	let state: OnboardingState | null = null;
	let loading = true;
	let error = '';
	let mounted = false;
	// The client this page was last asked to show (set before the fetch, so a
	// failed load does not retry in a loop).
	let requestedFor: string | null = null;
	// Bumped on every open(): an await resuming under a newer generation
	// belongs to a client no longer on screen and must not write anything.
	let openGen = 0;
	// A write in flight: ticks and stage moves wait for it.
	let busy = false;
	// The analyse click in flight, and the job it started (amendment A9).
	let starting = false;
	let watching: string | null = null;
	// Running analyse jobs for the loaded client at the last look.
	let seen: string[] = [];

	// Notes: the text on screen, the saves waiting out the debounce (each
	// holding the client id captured when the key was pressed), and the
	// saves in flight per step.
	type PendingNote = { id: string; value: string; gen: number; timer: ReturnType<typeof setTimeout> };
	let noteDrafts: Record<string, string> = {};
	let pendingNotes: Record<string, PendingNote> = {};
	let savingNote: Record<string, number> = {};
	// Per step, bumped on every keystroke and every finished save. A reload
	// whose GET started before a bump may carry the note from before it.
	let noteRev: Record<string, number> = {};
	const bumpRev = (step: string) => (noteRev[step] = (noteRev[step] ?? 0) + 1);
	const NOTE_DEBOUNCE_MS = 800;

	const token = () => localStorage.getItem('token') ?? '';

	/** Steps whose draft must survive a reload: the planner is still typing. */
	const heldSteps = () => [
		...Object.keys(pendingNotes),
		...Object.keys(savingNote).filter((s) => savingNote[s] > 0)
	];

	/** Read `id`'s rows. Dropped if the planner switched client meanwhile. */
	const load = async (id: string, gen: number = openGen) => {
		const revAtStart = { ...noteRev };
		try {
			const next = await getOnboarding(token(), id);
			if (gen !== openGen) return;
			state = next;
			noteDrafts = mergeNoteDrafts(noteDrafts, next.actions, notesToKeep(heldSteps(), revAtStart, noteRev));
			error = '';
		} catch (e) {
			if (gen !== openGen) return;
			error = actionMessage(e);
		}
		loading = false;
	};

	/** Save one note to the client it was typed for. */
	const saveNote = async (id: string, step: Step, value: string, gen: number) => {
		if (gen === openGen) savingNote = { ...savingNote, [step]: (savingNote[step] ?? 0) + 1 };
		try {
			await setAction(token(), id, step, null, { notes: value });
			if (gen === openGen) bumpRev(step);
			if (gen === openGen && state) {
				state = {
					...state,
					actions: state.actions.map((x) => (x.step === step ? { ...x, detail: { ...x.detail, notes: value } } : x))
				};
			}
		} catch (e) {
			if (gen === openGen) error = actionMessage(e);
		} finally {
			if (gen === openGen) savingNote = { ...savingNote, [step]: Math.max(0, (savingNote[step] ?? 1) - 1) };
		}
	};

	/** Send every note still waiting out its debounce, now, to its own client. */
	const flushNotes = () => {
		for (const [step, p] of Object.entries(pendingNotes)) {
			clearTimeout(p.timer);
			void saveNote(p.id, step as Step, p.value, p.gen);
		}
		pendingNotes = {};
	};

	/** Notes save 800 ms after the planner stops typing — one PUT per pause. */
	const onNote = (a: OnboardingAction, value: string) => {
		const id = state?.lead.xplanClientId;
		if (!id) return;
		const gen = openGen;
		const step = a.step;
		noteDrafts = { ...noteDrafts, [step]: value };
		bumpRev(step);
		clearTimeout(pendingNotes[step]?.timer);
		const timer = setTimeout(() => {
			if (pendingNotes[step]?.timer !== timer) return;
			const { [step]: _fired, ...rest } = pendingNotes;
			pendingNotes = rest;
			void saveNote(id, step, value, gen);
		}, NOTE_DEBOUNCE_MS);
		pendingNotes = { ...pendingNotes, [step]: { id, value, gen, timer } };
	};

	const open = async (id: string | null) => {
		// Notes typed for the client leaving go to that client, not the next.
		flushNotes();
		const gen = ++openGen;
		requestedFor = id;
		state = null;
		error = '';
		busy = false;
		starting = false;
		watching = null;
		seen = [];
		noteDrafts = {};
		savingNote = {};
		noteRev = {};
		if (!id) {
			loading = false;
			return;
		}
		loading = true;
		await refreshJobs(token());
		if (gen !== openGen) return;
		await load(id, gen);
		// An analyse started elsewhere (another tab) is still worth watching.
		void startJobPolling(token());
	};

	onMount(() => {
		mounted = true;
	});

	onDestroy(() => {
		flushNotes();
		openGen++;
	});

	// Reload whenever the active client is not the one on screen (B2).
	$: if (mounted && $linkableClientId !== requestedFor) void open($linkableClientId);

	$: loadedFor = state?.lead.xplanClientId ?? null;

	// Re-read the rows when an analyse for THIS client leaves the running list
	// — including the one just started, even if a fast skip meant it was never
	// seen running (A9).
	$: {
		const mine = loadedFor ? analyseJobs($syncJobs, loadedFor).map((j) => j.id) : [];
		const watched = watching ? [...seen, watching] : seen;
		const gone = watched.filter((jid) => !mine.includes(jid));
		if (loadedFor && gone.length) {
			watching = null;
			void load(loadedFor, openGen);
		}
		seen = mine;
	}

	const analyse = async () => {
		const gen = openGen;
		const id = state?.lead.xplanClientId;
		if (!id || !canAnalyse) return;
		starting = true;
		error = '';
		try {
			const { jobId } = await runAction(token(), id, stepId('clarify_goals'), 'onb_analyse', {});
			if (gen !== openGen) return;
			await refreshJobs(token());
			if (gen !== openGen) return;
			watching = jobId;
			void startJobPolling(token());
		} catch (e) {
			if (gen === openGen) error = actionMessage(e);
		} finally {
			if (gen === openGen) starting = false;
		}
	};

	const tick = async (step: Step, done: boolean) => {
		const gen = openGen;
		const id = state?.lead.xplanClientId;
		if (!id || busy) return;
		busy = true;
		try {
			await setAction(token(), id, step, done ? 'pending' : 'done');
		} catch (e) {
			if (gen === openGen) error = actionMessage(e);
		}
		if (gen !== openGen) return;
		await load(id, gen);
		busy = false;
	};

	// A lead still at enquiry has no discovery rows yet. Moving it here is the
	// planner's call, made explicit rather than done silently on arrival.
	const moveHere = async () => {
		const gen = openGen;
		const id = state?.lead.xplanClientId;
		if (!id || busy) return;
		busy = true;
		try {
			await setStage(token(), id, 'discovery');
		} catch (e) {
			if (gen === openGen) error = actionMessage(e);
		}
		if (gen !== openGen) return;
		await load(id, gen);
		busy = false;
	};

	const continueToDataEntry = async () => {
		const gen = openGen;
		const id = state?.lead.xplanClientId;
		if (!id || busy) return;
		busy = true;
		try {
			await setStage(token(), id, 'data_entry');
			if (gen === openGen) goto('/apps/data-entry');
		} catch (e) {
			if (gen === openGen) error = actionMessage(e);
		}
		if (gen === openGen) busy = false;
	};

	const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');

	$: actions = state?.actions ?? [];
	$: map = byStep(actions);
	$: stage = state?.lead.stage;
	$: atEnquiry = stage === 'enquiry';
	$: pastDiscovery = !!stage && stageAtLeast(stage, 'data_entry');
	$: completed = doneCount(actions, 'discovery');
	$: allDone = discoveryDone(actions);
	$: running = loadedFor ? analyseJobs($syncJobs, loadedFor) : [];
	$: analysing = running.length > 0;
	$: canAnalyse = stageAtLeast(stage, 'discovery') && !analysing && !starting;
	$: lastRun = lastRunAt(actions);
	$: fresh = newSinceLastRun(actions);
	$: skipped = skippedStores(actions);
	$: outcome = loadedFor && !analysing && !starting ? analyseOutcome($syncJobs, loadedFor) : null;
</script>

<div class="max-w-3xl mx-auto px-8 py-10">
	{#if !$linkableClientId || !$activeClient}
		<div class="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 p-8 text-center">
			<p class="text-sm font-medium">No client selected</p>
			<p class="text-sm text-gray-500 mt-1 mb-4">Pick a client on the Clients hub — Discovery works on the active client.</p>
			<button on:click={() => goto('/apps/clients')} class="inline-flex rounded-xl bg-black text-white dark:bg-white dark:text-black px-4 py-2.5 text-sm font-medium hover:opacity-90 transition">Choose a client</button>
		</div>
	{:else if loading}
		<p class="text-sm text-gray-500">Loading…</p>
	{:else if !state}
		<p class="text-sm text-red-600 dark:text-red-400">{error || 'Could not load this client.'}</p>
		<button on:click={() => open($linkableClientId)} class="mt-3 text-sm px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-850 transition">Retry</button>
	{:else}
		<div class="mb-6 flex items-start justify-between gap-4">
			<div>
				<p class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Stage 2 · Discovery Meeting</p>
				<h1 class="text-2xl font-semibold tracking-tight mt-1">{$activeClient.name}</h1>
				<p class="text-sm text-gray-500 mt-1">Understand the client — {completed}/{ROWS.length} done.</p>
			</div>
			<XplanLink path={`/factfind/view/${state.lead.xplanClientId}?role=client`} label="Fact Find" size="md" title="Open this client's Fact Find in XPLAN" />
		</div>
		{#if error}<p class="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>{/if}
		{#if $syncJobsError}<p class="text-sm text-amber-700 dark:text-amber-300 mb-3">{$syncJobsError}</p>{/if}

		{#if atEnquiry}
			<div class="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 p-6 text-center">
				<p class="text-sm">This client is still at Stage 1.</p>
				<p class="text-xs text-gray-500 mt-1">Analysis opens once the client is at Discovery.</p>
				<div class="flex justify-center gap-2 mt-3">
					<button on:click={() => goto('/apps/enquiry')} class="text-sm px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-850 transition">← Finish the enquiry</button>
					<button on:click={moveHere} disabled={busy} class="text-sm px-3 py-2 rounded-xl bg-black text-white dark:bg-white dark:text-black hover:opacity-90 transition">Move to Discovery anyway</button>
				</div>
			</div>
		{:else}
			<!-- The one button -->
			<div class="mb-6 rounded-2xl border border-gray-100 dark:border-gray-800 p-4 flex items-center justify-between gap-4">
				<div class="text-sm min-w-0">
					{#if analysing || starting}
						<p class="font-medium">Analysing…</p>
						<p class="text-gray-500 text-xs mt-0.5">{running[0]?.progress ?? 'Reading what axi holds about this client'}</p>
					{:else if lastRun}
						<p class="font-medium">Last analysed {when(lastRun)}</p>
						<p class="text-gray-500 text-xs mt-0.5">
							{#if fresh > 0}
								{fresh} new source{fresh === 1 ? '' : 's'} since the run before — re-analyse to fold in anything newer.
							{:else}
								Nothing new since the run before.
							{/if}
						</p>
						{#if skipped.length}
							<p class="text-amber-700 dark:text-amber-300 text-xs mt-1">Could not read: {skipped.join('; ')}</p>
						{/if}
					{:else}
						<p class="font-medium">Nothing analysed yet</p>
						<p class="text-gray-500 text-xs mt-0.5">Reads XPLAN, finny documents, salem meetings, notes and emails for this client.</p>
					{/if}
					{#if outcome}
						<p class="text-xs mt-1 {outcome.kind === 'error' ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-300'}">
							{outcome.kind === 'skipped' ? 'Last run skipped' : outcome.kind === 'error' ? 'Last run failed' : 'Last run warned'}: {outcome.text}
						</p>
					{/if}
				</div>
				<button on:click={analyse} disabled={!canAnalyse} class="shrink-0 rounded-xl bg-black text-white dark:bg-white dark:text-black px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-40 transition">
					{lastRun ? 'Re-analyse' : 'Analyse what we have'}
				</button>
			</div>

			<!-- The four rows -->
			<div class="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
				{#each ROWS as r (r.step)}
					{@const a = map.get(r.step)}
					{@const done = a?.status === 'done'}
					{@const analysis = analysisOf(a)}
					{@const previous = previousOf(a)}
					{@const changed = changedCount(a)}
					{@const rowError = a?.status === 'failed' ? errorOf(a) : null}
					<div class="px-4 py-4">
						<label class="flex items-start gap-3 cursor-pointer">
							<input type="checkbox" checked={done} disabled={busy || !a} on:click|preventDefault={() => tick(r.step, done)} class="mt-0.5 size-4 rounded accent-black dark:accent-white" />
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<p class="text-sm font-medium {done ? 'line-through text-gray-400' : ''}">{r.title}</p>
									{#if analysis}
										<span class="text-[11px] px-2 py-0.5 rounded-full {confidenceClass(analysis.confidence)}" title="confidence {Math.round(analysis.confidence * 100)}%">{confidenceLabel(analysis.confidence)}</span>
									{/if}
									{#if changed}
										<span class="text-[11px] text-amber-700 dark:text-amber-300">{changed} new since the run before</span>
									{/if}
								</div>
								<p class="text-xs text-gray-500 mt-0.5">{r.detail}</p>
							</div>
						</label>

						{#if rowError}
							<p class="mt-2 ml-7 text-xs text-red-600 dark:text-red-400">{rowError.message ?? 'The analysis failed for this step.'}</p>
						{/if}

						{#if analysis}
							<div class="mt-3 ml-7 space-y-3">
								{#if analysis.findings.length}
									<div>
										<p class="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Findings</p>
										<ul class="mt-1 space-y-1">
											{#each analysis.findings as f}<li class="text-sm">{f}</li>{/each}
										</ul>
									</div>
								{/if}
								{#if analysis.open_questions.length}
									<div>
										<p class="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Still open</p>
										<ul class="mt-1 space-y-1">
											{#each analysis.open_questions as q}<li class="text-sm text-amber-800 dark:text-amber-200">? {q}</li>{/each}
										</ul>
									</div>
								{:else if analysis.findings.length}
									<p class="text-xs text-green-700 dark:text-green-300">Nothing open for this step.</p>
								{:else}
									<p class="text-xs text-gray-400">No evidence found for this step yet.</p>
								{/if}
								{#if previous}
									<details class="text-xs text-gray-500">
										<summary class="cursor-pointer select-none">Previous run · {when(previous.run_at)} · {confidenceLabel(previous.confidence)}</summary>
										<ul class="mt-1 space-y-1">
											{#each previous.findings as f}<li>{f}</li>{/each}
											{#each previous.open_questions as q}<li class="text-amber-700 dark:text-amber-300">? {q}</li>{/each}
										</ul>
									</details>
								{/if}
							</div>
						{/if}

						{#if a}
							<div class="mt-3 ml-7">
								<textarea
									rows="2"
									placeholder="Your notes for this step…"
									value={noteDrafts[a.step] ?? ''}
									on:input={(e) => a && onNote(a, e.currentTarget.value)}
									class="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10"
								></textarea>
								{#if pendingNotes[a.step] || savingNote[a.step]}<p class="text-[11px] text-gray-400 mt-0.5">Saving…</p>{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>

			<div class="flex items-center justify-between gap-3 mt-5">
				<button on:click={() => goto('/apps/enquiry')} class="text-sm text-gray-500 hover:text-black dark:hover:text-white">← Enquiry</button>
				{#if pastDiscovery && stage}
					<button on:click={() => goto(STAGE_PAGE[stage] ?? '/apps/clients')} class="rounded-xl bg-black text-white dark:bg-white dark:text-black px-4 py-2.5 text-sm font-medium hover:opacity-90 transition">{STAGE_PAGE[stage] ? `Open ${STAGE_LABEL[stage]} →` : 'Back to Clients'}</button>
				{:else}
					<button on:click={continueToDataEntry} disabled={!allDone || busy} class="rounded-xl bg-black text-white dark:bg-white dark:text-black px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-40 transition">Continue to Data Entry &amp; Research →</button>
				{/if}
			</div>
			{#if pastDiscovery && stage}
				<p class="text-xs text-gray-400 mt-3">This client is at {STAGE_LABEL[stage]}; Discovery stays open to re-read and annotate.</p>
			{:else if !allDone}
				<p class="text-xs text-gray-400 mt-3">Tick all four to move this client to Data Entry &amp; Research.</p>
			{/if}
		{/if}
	{/if}
</div>
