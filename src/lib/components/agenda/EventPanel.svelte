<script lang="ts">
	// Side panel for one event: details, deep-link, and — when the source
	// lets us — Move. Client is editable (assign / change / clear → pins).
	// The page confirms and POSTs; this only reports intent (spec §10 item 3).
	import type { AgendaEvent } from '$lib/apis/gateway/agenda';
	import { SOURCE_META, toLocalInput, moveWindow, clientLabel } from '$lib/apps/agenda';
	import { createEventDispatcher } from 'svelte';

	export let event: AgendaEvent;
	export let xplanLocked = false;
	export let busy = false;
	const dispatch = createEventDispatcher<{
		close: void;
		open: AgendaEvent;
		move: { event: AgendaEvent; startAt: string; endAt: string };
		assign: AgendaEvent;
		unpin: AgendaEvent;
	}>();

	let moving = false;
	let startLocal = '';
	let endLocal = '';
	let moveError = '';

	// Reset the form whenever a different event is selected.
	$: if (event) { moving = false; moveError = ''; }

	const startMove = () => {
		startLocal = toLocalInput(event.startAt);
		endLocal = toLocalInput(event.endAt || event.startAt);
		moveError = '';
		moving = true;
	};
	const submitMove = () => {
		const w = moveWindow(startLocal, endLocal);
		if ('error' in w) { moveError = w.error; return; }
		moving = false;
		dispatch('move', { event, startAt: w.startAt, endAt: w.endAt });
	};

	const when = (e: AgendaEvent) => {
		if (e.allDay) return `${e.startAt.slice(0, 10)} · all day`;
		const s = new Date(e.startAt), en = new Date(e.endAt || e.startAt);
		return `${s.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} – ${en.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
	};
	$: linkDisabled = event.source === 'xplan' && xplanLocked;
	$: canMove = event.writable && !event.allDay;
</script>

<aside class="rounded-2xl border border-gray-100 dark:border-gray-800 p-4 space-y-3 text-sm {busy ? 'opacity-60' : ''}">
	<div class="flex items-start justify-between gap-2">
		<div>
			<span class="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-gray-500">
				<span class="w-2 h-2 rounded-full" style="background:{SOURCE_META[event.source].color}"></span>{SOURCE_META[event.source].label}
			</span>
			<h3 class="font-medium mt-1">{event.title}</h3>
		</div>
		<button type="button" on:click={() => dispatch('close')} class="text-gray-400 hover:text-gray-700">✕</button>
	</div>
	<p class="text-gray-600 dark:text-gray-300">{when(event)}</p>
	{#if event.location}<p class="text-gray-500">📍 {event.location}</p>{/if}

	<div class="text-gray-500 flex flex-wrap items-center gap-x-2 gap-y-1">
		{#if event.client}
			<span>Client: <span class="text-gray-800 dark:text-gray-200">{event.client.name}</span>
				<span class="text-xs">({clientLabel(event.client.via)})</span></span>
			<button type="button" disabled={busy} on:click={() => dispatch('assign', event)} class="text-xs underline disabled:opacity-40">change</button>
			{#if event.client.via === 'pin'}
				<button type="button" disabled={busy} on:click={() => dispatch('unpin', event)} class="text-xs underline disabled:opacity-40">clear</button>
			{/if}
		{:else}
			<span>No client</span>
			<button type="button" disabled={busy} on:click={() => dispatch('assign', event)} class="text-xs underline disabled:opacity-40">assign…</button>
		{/if}
	</div>

	{#if event.attendees.length}
		<ul class="text-xs text-gray-500">{#each event.attendees as a}<li>{a.name ?? a.email}{#if a.name && a.email} · {a.email}{/if}</li>{/each}</ul>
	{/if}

	{#if moving}
		<form class="space-y-2 rounded-xl bg-gray-50 dark:bg-gray-850 p-3" on:submit|preventDefault={submitMove}>
			<label class="block text-xs text-gray-500">Start
				<input type="datetime-local" bind:value={startLocal} class="mt-0.5 w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1" />
			</label>
			<label class="block text-xs text-gray-500">End
				<input type="datetime-local" bind:value={endLocal} class="mt-0.5 w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1" />
			</label>
			{#if moveError}<p class="text-xs text-red-600">{moveError}</p>{/if}
			<div class="flex gap-2">
				<button type="submit" disabled={busy} class="text-xs font-medium px-3 py-1.5 rounded-lg bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-50">Move</button>
				<button type="button" on:click={() => (moving = false)} class="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700">Cancel</button>
			</div>
		</form>
	{/if}

	<div class="flex flex-wrap gap-2">
		<button type="button" disabled={linkDisabled} on:click={() => dispatch('open', event)}
			title={linkDisabled ? 'XPLAN access is locked' : ''}
			class="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-850 disabled:opacity-50">
			{SOURCE_META[event.source].openLabel} ↗
		</button>
		{#if canMove && !moving}
			<button type="button" disabled={busy} on:click={startMove}
				class="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-850 disabled:opacity-50">Move…</button>
		{/if}
	</div>
</aside>
