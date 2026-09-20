<script lang="ts">
	// One chip per source: connection state + the connect/disconnect action.
	// The states live in sourceChip() (apps/agenda.ts); this file only draws
	// them. `$: chips` names every input, so it re-runs when they arrive.
	import { createEventDispatcher } from 'svelte';
	import type { AgendaSource, AgendaSourceStatus, ConnectorsResponse, ConnectorProvider } from '$lib/apis/gateway/agenda';
	import { sourceChip, type SourceChip } from '$lib/apps/agenda';

	export let sources: Partial<Record<AgendaSource, AgendaSourceStatus>> = {};
	export let connectors: ConnectorsResponse | null = null;
	export let busy: ConnectorProvider | null = null;

	const dispatch = createEventDispatcher<{ connect: ConnectorProvider; disconnect: ConnectorProvider }>();

	const time = (iso: string) => {
		const d = new Date(iso);
		return isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	};

	$: chips = (['xplan', 'm365', 'google'] as AgendaSource[]).map((s) => sourceChip(s, sources, connectors, time));

	const act = (c: SourceChip) => {
		if (!c.action) return;
		dispatch(c.action, c.source as ConnectorProvider);
	};
	const hint = (c: SourceChip) =>
		c.action === 'disconnect' ? `${c.label} connected as ${c.text} — click to disconnect`
		: c.action === 'connect' ? (c.state === 'warn' ? `${c.label} needs to be connected again` : `Connect ${c.label} to read its calendar and tasks here`)
		: c.source === 'xplan' && c.state === 'off' ? 'Read with the Re-read XPLAN button'
		: c.label;
</script>

<div class="flex flex-wrap items-center gap-2">
	{#each chips as c (c.source)}
		<button
			type="button"
			disabled={!c.action || busy === c.source}
			on:click={() => act(c)}
			title={hint(c)}
			class="group inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition
				{c.state === 'ok' ? 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-850' : ''}
				{c.state === 'warn' ? 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300' : ''}
				{c.state === 'off' ? 'border-dashed border-gray-300 text-gray-500 dark:border-gray-600' : ''}
				{c.action ? 'hover:bg-gray-100 dark:hover:bg-gray-800' : 'cursor-default'}"
		>
			<span class="w-2 h-2 rounded-full {c.state === 'off' ? 'opacity-40' : ''}" style="background:{c.color}"></span>
			<span class="font-medium">{c.label}</span>
			{#if busy === c.source}
				<span class="text-gray-500">…</span>
			{:else if c.state === 'ok'}
				<span class="text-gray-500 group-hover:hidden">✓ {c.text}</span>
				{#if c.action === 'disconnect'}<span class="hidden group-hover:inline text-red-600 dark:text-red-400">disconnect</span>{/if}
			{:else if c.action === 'connect'}
				<span class="{c.state === 'warn' ? '' : 'text-gray-600 dark:text-gray-300'} underline decoration-dotted underline-offset-2">{c.state === 'warn' ? '↻ reconnect' : '+ connect'}</span>
			{:else}
				<span class="text-gray-500">{c.text}</span>
			{/if}
		</button>
	{/each}
</div>
