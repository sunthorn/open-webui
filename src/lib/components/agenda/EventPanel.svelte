<script lang="ts">
	// Side panel for one event. Read-only in this build: details + deep-link.
	import type { AgendaEvent } from '$lib/apis/gateway/agenda';
	import { SOURCE_META } from '$lib/apps/agenda';
	import { createEventDispatcher } from 'svelte';

	export let event: AgendaEvent;
	export let xplanLocked = false;
	const dispatch = createEventDispatcher<{ close: void; open: AgendaEvent }>();

	const when = (e: AgendaEvent) => {
		if (e.allDay) return `${e.startAt.slice(0, 10)} · all day`;
		const s = new Date(e.startAt), en = new Date(e.endAt || e.startAt);
		return `${s.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} – ${en.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
	};
	$: disabled = event.source === 'xplan' && xplanLocked;
</script>

<aside class="rounded-2xl border border-gray-100 dark:border-gray-800 p-4 space-y-3 text-sm">
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
	{#if event.client}
		<p class="text-gray-500">Client: <span class="text-gray-800 dark:text-gray-200">{event.client.name}</span>
			<span class="text-xs">({event.client.via === 'pin' ? 'pinned by you' : 'matched by rule'})</span></p>
	{/if}
	{#if event.attendees.length}
		<ul class="text-xs text-gray-500">{#each event.attendees as a}<li>{a.name ?? a.email}{#if a.name && a.email} · {a.email}{/if}</li>{/each}</ul>
	{/if}
	<button type="button" {disabled} on:click={() => dispatch('open', event)}
		title={disabled ? 'XPLAN access is locked' : ''}
		class="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-850 disabled:opacity-50">
		{SOURCE_META[event.source].openLabel} ↗
	</button>
</aside>
