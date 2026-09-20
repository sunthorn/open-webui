<script lang="ts">
	// Briefing — the planner's day. Two GETs, no LLM on load: /gw/agenda
	// (three sources merged, client-matched) and briefing:daily (the agent's
	// narrative, when one exists). Spec: docs/superpowers/specs/
	// 2026-09-14-briefing-home-design.md §10. Writes go through the confirm →
	// POST → re-fetch flow below; pins and the agent's suggestions are edited
	// inline.
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { page } from '$app/stores';
	import { getBriefing, openInXplan, type DailyBriefing } from '$lib/apis/gateway';
	import {
		getAgenda, getConnectors, authorizeConnector, disconnectConnector, isoDate,
		completeTask, snoozeTask, moveEvent, putPin, deletePins,
		type AgendaResponse, type AgendaEvent, type AgendaTask, type ConnectorsResponse, type ConnectorProvider
	} from '$lib/apis/gateway/agenda';
	import {
		fallbackAttention, sourceCalendars, toCalendarEvents,
		snoozeUntil, describeChange, applyChange, type AgendaChange
	} from '$lib/apps/agenda';
	import ClientPicker from '$lib/components/apps/ClientPicker.svelte';
	import { syncJobs, syncJobsError, startJob, stopJob, runningJob } from '$lib/stores/syncJobs';
	import CalendarView from '$lib/components/calendar/CalendarView.svelte';
	import SourceChips from '$lib/components/agenda/SourceChips.svelte';
	import DayTimeline from '$lib/components/agenda/DayTimeline.svelte';
	import TodoByClient from '$lib/components/agenda/TodoByClient.svelte';
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
	let busy: ConnectorProvider | null = null;
	let view: 'today' | 'week' = 'today';
	let selected: AgendaEvent | null = null;
	let greeting = 'Hello';
	let busyId: string | null = null;
	let assigning: AgendaTask | AgendaEvent | null = null;

	$: xplanLocked = agenda?.sources.xplan?.status === 'locked';
	$: sourceErrors = Object.entries(agenda?.sources ?? {}).filter(([, s]) => s?.status === 'error') as [string, { message?: string }][];
	$: attention = agenda ? fallbackAttention(agenda.tasks, today) : [];
	$: weekEvents = agenda ? toCalendarEvents(agenda.events) : [];
	const calendars = sourceCalendars();
	const visible = new Set(calendars.map((c) => c.id));

	// Keeps the open event panel showing the current agenda's copy of the
	// selected event — after a write, a reload, or a rollback — instead of a
	// stale snapshot from before the change.
	const resync = () => { if (selected && agenda) selected = agenda.events.find((e) => e.id === selected!.id) ?? selected; };

	const load = async (refresh = false) => {
		loading = true;
		loadError = '';
		try {
			[agenda, connectors, briefing] = await Promise.all([
				getAgenda(token(), today, weekEnd, refresh),
				getConnectors(token()).catch(() => null),
				getBriefing(token()).catch(() => null)
			]);
			resync();
		} catch (e: any) {
			loadError = e?.message ?? 'Could not load your agenda';
		} finally {
			loading = false;
		}
	};

	const connect = async (p: ConnectorProvider) => {
		busy = p;
		try {
			window.location.href = await authorizeConnector(token(), p);
		} catch (e: any) {
			err = e?.message ?? `Could not start ${p} sign-in`;
			busy = null;
		}
	};
	const disconnect = async (p: ConnectorProvider) => {
		if (!confirm(`Disconnect ${p === 'm365' ? 'Outlook' : 'Google'}? Your events and tasks from it will disappear from this page.`)) return;
		busy = p;
		try {
			await disconnectConnector(token(), p);
			await load(true);
		} catch (e: any) {
			err = e?.message ?? 'Could not disconnect';
		} finally {
			busy = null;
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
		const q = get(page).url.searchParams;
		if (q.get('connector_error')) err = `Connection failed: ${q.get('connector_error')}`;
		load(Boolean(q.get('connected')));
	});

	const compiledLabel = (iso: string) => {
		const d = new Date(iso);
		return isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	};
</script>

<div class="max-w-5xl mx-auto px-8 py-10">
	<div class="flex flex-wrap items-start justify-between gap-4 mb-6">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">{greeting}</h1>
			<p class="text-sm text-gray-500 mt-1">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
			<div class="mt-3"><SourceChips sources={agenda?.sources ?? {}} {connectors} {busy} on:connect={(e) => connect(e.detail)} on:disconnect={(e) => disconnect(e.detail)} /></div>
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
					<div class="rounded-2xl border border-gray-100 dark:border-gray-800 p-4 text-sm whitespace-pre-line">{briefing.narrative}</div>
					<p class="text-xs text-gray-400 mt-1">the agent's view, from your calendars and XPLAN · compiled {compiledLabel(briefing.compiledAt)} · updates when you re-read XPLAN</p>
				{:else if attention.length}
					<ul class="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
						{#each attention as t (t.id)}
							<li class="px-4 py-2.5 text-sm flex justify-between gap-3">
								<span>{t.title}{#if t.client} <span class="text-gray-500">· {t.client.name}</span>{/if}</span>
								<span class="text-xs shrink-0 {t.status === 'overdue' ? 'text-red-600' : 'text-gray-400'}">{t.status === 'overdue' ? 'overdue' : 'today'}</span>
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
				<div class="flex items-center justify-between mb-3">
					<h2 class="text-xs font-semibold uppercase tracking-wide text-gray-500">Calendar</h2>
					<div class="text-xs rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
						<button class="px-3 py-1 {view === 'today' ? 'bg-gray-100 dark:bg-gray-800 font-medium' : ''}" on:click={() => (view = 'today')}>Today</button>
						<button class="px-3 py-1 {view === 'week' ? 'bg-gray-100 dark:bg-gray-800 font-medium' : ''}" on:click={() => (view = 'week')}>Week</button>
					</div>
				</div>
				<div class="grid gap-4 {selected ? 'md:grid-cols-[1fr_18rem]' : ''}">
					<div>
						{#if view === 'today'}
							<DayTimeline events={agenda.events} day={today} on:select={(e) => (selected = e.detail)} />
						{:else}
							<div class="rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
								<CalendarView events={weekEvents} {calendars} visibleCalendarIds={visible} view="week" currentDate={new Date()}
									on:eventClick={(e) => (selected = agenda?.events.find((x) => x.id === e.detail.id) ?? null)} />
							</div>
						{/if}
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

			<section>
				<h2 class="text-xs font-semibold uppercase tracking-wide mb-3 text-gray-500">To do, by client</h2>
				<TodoByClient tasks={agenda.tasks} {today} {xplanLocked} {busyId} on:open={(e) => open(e.detail)}
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
