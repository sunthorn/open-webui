<script lang="ts">
	// Briefing — the planner's day. Two GETs, no LLM on load: /gw/agenda
	// (three sources merged, client-matched) and briefing:daily (the agent's
	// narrative, when one exists). Spec: docs/superpowers/specs/
	// 2026-09-14-briefing-home-design.md §10. Writes go through the confirm →
	// POST → re-fetch flow below; pins and the agent's suggestions are edited
	// inline.
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { getBriefing, openInXplan, type DailyBriefing } from '$lib/apis/gateway';
	import {
		getAgenda, getConnectors, isoDate,
		completeTask, snoozeTask, moveEvent, putPin, deletePins,
		type AgendaResponse, type AgendaEvent, type AgendaTask, type ConnectorsResponse
	} from '$lib/apis/gateway/agenda';
	import {
		fallbackAttention, snoozeUntil, describeChange, applyChange, type AgendaChange, narrativePoints
	} from '$lib/apps/agenda';
	import ClientPicker from '$lib/components/apps/ClientPicker.svelte';
	import { syncJobs, syncJobsError, startJob, stopJob, runningJob } from '$lib/stores/syncJobs';
	import SourceChips from '$lib/components/agenda/SourceChips.svelte';
	import AgendaCalendar from '$lib/components/agenda/AgendaCalendar.svelte';
	import TodoList from '$lib/components/agenda/TodoList.svelte';
	import EventPanel from '$lib/components/agenda/EventPanel.svelte';

	const token = () => localStorage.getItem('token') ?? '';
	const today = isoDate(new Date());
	const weekEnd = isoDate(new Date(Date.now() + 7 * 86400000));

	let agenda: AgendaResponse | null = null;
	let connectors: ConnectorsResponse | null = null;
	let briefing: DailyBriefing | null = null;
	let loading = true;
	let loadError = '';
	let err = '';
	let selected: AgendaEvent | null = null;
	// Bumped after every reload so the calendar re-reads the range it shows
	// (it fetches its own data outside the page's today + 7 days).
	let refreshKey = 0;
	let greeting = 'Hello';
	let busyId: string | null = null;
	let assigning: AgendaTask | AgendaEvent | null = null;

	$: xplanLocked = agenda?.sources.xplan?.status === 'locked';
	$: sourceErrors = Object.entries(agenda?.sources ?? {}).filter(([, s]) => s?.status === 'error') as [string, { message?: string }][];
	$: attention = agenda ? fallbackAttention(agenda.tasks, today) : { overdue: 0, dueToday: [] };

	// Keeps the open event panel showing the current agenda's copy of the
	// selected event — after a write, a reload, or a rollback — instead of a
	// stale snapshot from before the change.
	const resync = () => {
		if (!selected) return;
		const id = selected.id;
		selected = agenda?.events.find((e) => e.id === id) ?? selected;
	};

	const load = async (refresh = false) => {
		loading = true;
		loadError = '';
		try {
			[agenda, connectors, briefing] = await Promise.all([
				getAgenda(token(), today, weekEnd, refresh),
				getConnectors(token()).catch(() => null),
				getBriefing(token()).catch(() => null)
			]);
			refreshKey += 1;
			resync();
		} catch (e: any) {
			loadError = e?.message ?? 'Could not load your agenda';
		} finally {
			loading = false;
		}
	};

	// Deep-link: XPLAN paths open in the debug Chrome via the gateway; the
	// others are ordinary URLs in a new tab.
	const open = async (item: AgendaEvent | AgendaTask) => {
		err = '';
		if (item.source === 'xplan') {
			try { await openInXplan(token(), item.href); } catch (e: any) { err = e?.message ?? 'Could not open XPLAN'; }
		} else {
			window.open(item.href, '_blank', 'noopener');
		}
	};

	// The write flow (spec §10): confirm the exact change → apply it to the
	// page → POST → re-fetch. On error, put the page back and show the
	// gateway's one-line reason. One item per call; no bulk.
	const post = (c: AgendaChange): Promise<unknown> => {
		const t = token();
		switch (c.kind) {
			case 'complete': return completeTask(t, c.task.source, c.task.sourceId);
			case 'snooze': return snoozeTask(t, c.task.source, c.task.sourceId, c.until);
			case 'move': return moveEvent(t, c.event.source, c.event.sourceId, c.startAt, c.endAt);
			case 'pin': return putPin(t, { source: c.item.source, sourceId: c.item.sourceId, clientId: c.clientId, verdict: 'match' });
			case 'reject': return putPin(t, { source: c.task.source, sourceId: c.task.sourceId, clientId: c.clientId, verdict: 'reject' });
			case 'unpin': return deletePins(t, c.item.source, c.item.sourceId);
		}
	};
	const itemOf = (c: AgendaChange) => ('task' in c ? c.task : 'event' in c ? c.event : c.item);
	const run = async (c: AgendaChange) => {
		if (!agenda || !confirm(describeChange(c))) return;
		err = '';
		const before = agenda;
		busyId = itemOf(c).id;
		agenda = applyChange(agenda, c);
		resync();
		try {
			await post(c);
			await load(true);
		} catch (e: any) {
			agenda = before;
			resync();
			err = e?.message ?? 'The change did not go through';
		} finally {
			busyId = null;
		}
	};
	const pick = (e: CustomEvent<{ id: string; name: string }>) => {
		const item = assigning;
		assigning = null;
		if (item) void run({ kind: 'pin', item, clientId: e.detail.id, clientName: e.detail.name });
	};

	// The XPLAN re-read is a worker job (spends tokens). Same wiring the old page had.
	const reread = async () => {
		err = '';
		jobNote = '';
		const started = await startJob(token(), 'briefing');
		if (!started) err = get(syncJobsError) ?? 'Could not start the re-read.';
	};
	$: briefingJob = runningJob($syncJobs, 'briefing');
	$: lastRun = $syncJobs.last.briefing;
	let seenRun = '';
	let jobNote = '';
	$: if (lastRun && lastRun.id !== seenRun) {
		seenRun = lastRun.id;
		if (lastRun.status === 'done') {
			jobNote = lastRun.error ?? '';
			void load(true);
		} else if (lastRun.status !== 'cancelled') err = lastRun.error ?? '';
	}

	onMount(() => {
		const h = new Date().getHours();
		greeting = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
		load(false);
	});

	const compiledLabel = (iso: string) => {
		const d = new Date(iso);
		return isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	};
</script>

<div class="max-w-7xl mx-auto px-4 sm:px-8 py-10">
	<div class="flex flex-wrap items-start justify-between gap-4 mb-6">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">{greeting}</h1>
			<p class="text-sm text-gray-500 mt-1">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
			<div class="mt-3"><SourceChips sources={agenda?.sources ?? {}} {connectors} /></div>
		</div>
		<!-- Two reads, two costs. Refresh asks Outlook/Google again (the page
		     otherwise reuses a read for 5 min); Re-read drives the XPLAN browser
		     and asks the agent for its view. Each button says what it touches
		     and when it last did — the old "Rebuild" link ran the same job as
		     Re-read under a different name. -->
		<div class="shrink-0 flex items-stretch gap-2">
			{#if briefingJob}
				<button on:click={() => stopJob(token(), briefingJob.id)} class="text-xs font-medium text-red-600 px-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">Stop</button>
			{/if}
			<button on:click={() => load(true)} disabled={loading}
				title="Asks Outlook and Google again now. Without this, the page reuses a read for 5 minutes. XPLAN is not re-read here."
				class="text-left px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-850 disabled:opacity-50">
				<span class="block text-xs font-medium">{loading ? 'Refreshing…' : 'Refresh'}</span>
				<span class="block text-[11px] text-gray-500">Outlook &amp; Google · instant{#if agenda} · read {compiledLabel(agenda.compiledAt)}{/if}</span>
			</button>
			<button on:click={reread} disabled={!!briefingJob || xplanLocked}
				title={xplanLocked ? 'XPLAN access is locked' : "Reads the task list and diary from your signed-in XPLAN (scripted, ~10 s), then asks the agent for its view of the day."}
				class="text-left px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-850 disabled:opacity-50">
				<span class="block text-xs font-medium">{briefingJob ? (briefingJob.status === 'queued' ? 'Queued…' : 'Re-reading XPLAN…') : 'Re-read XPLAN'}</span>
				<span class="block text-[11px] {xplanLocked ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500'}">
					{#if xplanLocked}locked — no reads until unlocked{:else}tasks, diary &amp; agent's view · ~10 s · {agenda?.sources.xplan?.readAt ? `read ${compiledLabel(agenda.sources.xplan.readAt)}` : 'not read yet'}{/if}
				</span>
			</button>
		</div>
	</div>

	{#if jobNote}<p class="text-xs text-amber-700 dark:text-amber-300 -mt-3 mb-4">{jobNote}</p>{/if}
	{#if err}<div class="mb-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-3">{err}</div>{/if}
	{#each sourceErrors as [src, s]}
		<div class="mb-2 text-sm text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-4 py-2">
			{src === 'm365' ? 'Outlook' : src === 'google' ? 'Google' : 'XPLAN'}: {s.message ?? 'unavailable'}
		</div>
	{/each}

	{#if loading && !agenda}
		<p class="text-sm text-gray-500">Loading your day…</p>
	{:else if loadError}
		<div class="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-6 text-sm">
			<p class="font-medium text-red-700 dark:text-red-400">Couldn't load the agenda.</p>
			<p class="mt-1 text-red-600/80">{loadError}</p>
			<button on:click={() => load()} class="mt-3 underline text-red-700 dark:text-red-400">Try again</button>
		</div>
	{:else if agenda}
		<div class="space-y-8">
			<section>
				<div class="flex items-center justify-between mb-3">
					<h2 class="text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">⚠ Needs attention</h2>
					{#if briefingJob}<span class="text-xs text-gray-400">{briefingJob.progress || 'the agent is re-reading…'}</span>{/if}
				</div>
				{#if briefing?.narrative}
					<ul class="rounded-2xl border border-gray-100 dark:border-gray-800 p-4 pl-8 text-sm list-disc space-y-1">
						{#each narrativePoints(briefing.narrative) as point}<li>{point}</li>{/each}
					</ul>
					<p class="text-xs text-gray-400 mt-1">the agent's view, from your calendars and XPLAN · compiled {compiledLabel(briefing.compiledAt)} · updates when you re-read XPLAN</p>
				{:else if attention.overdue || attention.dueToday.length}
					<ul class="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
						{#if attention.overdue}
							<li class="px-4 py-2.5 text-sm">
								<a href="#todo-by-client" class="text-red-600 dark:text-red-400 hover:underline">
									{attention.overdue} overdue {attention.overdue === 1 ? 'task' : 'tasks'} — listed under Overdue below ↓
								</a>
							</li>
						{/if}
						{#each attention.dueToday as t (t.id)}
							<li class="px-4 py-2.5 text-sm flex justify-between gap-3">
								<span>{t.title}{#if t.client} <span class="text-gray-500">· {t.client.name}</span>{/if}</span>
								<span class="text-xs shrink-0 text-gray-400">today</span>
							</li>
						{/each}
					</ul>
					<p class="text-xs text-gray-400 mt-1">rules only (overdue and due today) — <button on:click={reread} disabled={!!briefingJob || xplanLocked} class="underline disabled:opacity-50 disabled:no-underline">re-read XPLAN</button> for the agent's view</p>
				{:else}
					<p class="text-sm text-gray-500">Nothing overdue or due today.</p>
					<p class="text-xs text-gray-400 mt-1">rules only — <button on:click={reread} disabled={!!briefingJob || xplanLocked} class="underline disabled:opacity-50 disabled:no-underline">re-read XPLAN</button> for the agent's view</p>
				{/if}
			</section>

			<section>
				<h2 class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Calendar</h2>
				<div class="grid gap-4 {selected ? 'lg:grid-cols-[1fr_18rem]' : ''}">
					<div class="min-w-0">
						<AgendaCalendar token={token()} {today} todayEvents={agenda.events} {refreshKey}
							selectedId={selected?.id ?? null}
							on:select={(e) => (selected = e.detail)}
							on:move={(e) => run({ kind: 'move', ...e.detail })} />
					</div>
					{#if selected}
						<EventPanel event={selected} {xplanLocked} busy={busyId === selected.id}
							on:close={() => (selected = null)} on:open={(e) => open(e.detail)}
							on:move={(e) => run({ kind: 'move', ...e.detail })}
							on:assign={(e) => (assigning = e.detail)}
							on:unpin={(e) => run({ kind: 'unpin', item: e.detail })} />
					{/if}
				</div>
			</section>

			<section id="todo-by-client" class="scroll-mt-4">
				<h2 class="text-xs font-semibold uppercase tracking-wide mb-3 text-gray-500">To do</h2>
				<TodoList tasks={agenda.tasks} {today} {xplanLocked} {busyId} on:open={(e) => open(e.detail)}
					on:complete={(e) => run({ kind: 'complete', task: e.detail })}
					on:snooze={(e) => run({ kind: 'snooze', task: e.detail.task, until: snoozeUntil(today, e.detail.choice) })}
					on:accept={(e) => e.detail.suggestion && run({ kind: 'pin', item: e.detail, clientId: e.detail.suggestion.clientId, clientName: e.detail.suggestion.name })}
					on:reject={(e) => e.detail.suggestion && run({ kind: 'reject', task: e.detail, clientId: e.detail.suggestion.clientId, clientName: e.detail.suggestion.name })}
					on:assign={(e) => (assigning = e.detail)}
					on:unpin={(e) => run({ kind: 'unpin', item: e.detail })} />
			</section>

			<p class="text-xs text-gray-400">
				Agenda compiled {compiledLabel(agenda.compiledAt)}{#if agenda.sources.xplan?.readAt} · XPLAN last read {compiledLabel(agenda.sources.xplan.readAt)}{/if}. Chats stay in axi's native history.
			</p>
		</div>
	{/if}

	{#if assigning}
		<div class="fixed inset-0 z-40 bg-black/30 flex items-start justify-center pt-24" role="dialog" aria-label="Assign client">
			<div class="relative w-80">
				<p class="text-xs text-white/90 mb-1 truncate">Assign "{assigning.title}" to…</p>
				<ClientPicker mode="pick" placeholder="Search the client book…" on:pick={pick} on:close={() => (assigning = null)} />
			</div>
		</div>
	{/if}
</div>
