<script lang="ts">
	// One chip per source: connection state + the connect/disconnect action.
	// XPLAN's chip is informational — its connection is the debug Chrome, and
	// its state comes from the aggregator ('ok' | 'locked' | 'disconnected').
	import { createEventDispatcher } from 'svelte';
	import type { AgendaSource, AgendaSourceStatus, ConnectorsResponse, ConnectorProvider } from '$lib/apis/gateway/agenda';
	import { SOURCE_META } from '$lib/apps/agenda';

	export let sources: Partial<Record<AgendaSource, AgendaSourceStatus>> = {};
	export let connectors: ConnectorsResponse | null = null;
	export let busy: ConnectorProvider | null = null;

	const dispatch = createEventDispatcher<{ connect: ConnectorProvider; disconnect: ConnectorProvider }>();

	type Chip = { source: AgendaSource; label: string; color: string; state: 'ok' | 'warn' | 'off'; text: string; action?: 'connect' | 'disconnect' };

	const chip = (s: AgendaSource): Chip => {
		const meta = SOURCE_META[s];
		const st = sources[s];
		if (s === 'xplan') {
			if (st?.status === 'locked') return { source: s, ...meta, state: 'warn', text: 'locked' };
			if (st?.status === 'ok') return { source: s, ...meta, state: 'ok', text: '✓' };
			return { source: s, ...meta, state: 'off', text: 'not read yet' };
		}
		const c = connectors?.[s as ConnectorProvider];
		if (!c || c.status === 'disconnected') return { source: s, ...meta, state: 'off', text: 'connect', action: 'connect' };
		if (c.status !== 'ok' || st?.status === 'error') return { source: s, ...meta, state: 'warn', text: 'reconnect', action: 'connect' };
		return { source: s, ...meta, state: 'ok', text: c.email ?? '✓', action: 'disconnect' };
	};

	$: chips = (['xplan', 'm365', 'google'] as AgendaSource[]).map(chip);

	const act = (c: Chip) => {
		if (!c.action) return;
		dispatch(c.action, c.source as ConnectorProvider);
	};
</script>

<div class="flex flex-wrap items-center gap-2">
	{#each chips as c}
		<button
			type="button"
			disabled={!c.action || busy === c.source}
			on:click={() => act(c)}
			title={c.action === 'disconnect' ? `Disconnect ${c.label}` : c.action === 'connect' ? `Connect ${c.label}` : c.label}
			class="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition
				{c.state === 'ok' ? 'border-gray-200 dark:border-gray-700' : ''}
				{c.state === 'warn' ? 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300' : ''}
				{c.state === 'off' ? 'border-dashed border-gray-300 text-gray-500 dark:border-gray-600' : ''}
				{c.action ? 'hover:bg-gray-100 dark:hover:bg-gray-850' : 'cursor-default'}"
		>
			<span class="w-2 h-2 rounded-full" style="background:{c.color}"></span>
			<span class="font-medium">{c.label}</span>
			<span class="text-gray-500">{busy === c.source ? '…' : c.text}</span>
		</button>
	{/each}
</div>
