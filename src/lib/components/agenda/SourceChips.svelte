<script lang="ts">
	// XPLAN, then the planner's work account (the one sign-in, chosen on
	// Meetings › Connections). The states live in sourceChips() (apps/agenda.ts);
	// this file only draws them. Connecting, reconnecting and switching happen
	// on Connections, so every action is a link there.
	import type { AgendaSource, AgendaSourceStatus, ConnectorsResponse } from '$lib/apis/gateway/agenda';
	import { sourceChips, CONNECTIONS_HREF, type SourceChip } from '$lib/apps/agenda';

	export let sources: Partial<Record<AgendaSource, AgendaSourceStatus>> = {};
	export let connectors: ConnectorsResponse | null = null;

	const time = (iso: string) => {
		const d = new Date(iso);
		return isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	};

	$: chips = sourceChips(sources, connectors, time);

	const hint = (c: SourceChip) =>
		c.source === 'work' ? 'Choose your work account in Meetings › Connections — its calendar and to-dos show here'
		: c.action && c.state === 'ok' ? `${c.label} — your work account (${c.text}). Change it in Meetings › Connections`
		: c.action ? `${c.label} needs reconnecting in Meetings › Connections`
		: c.source === 'xplan' && c.state === 'off' ? 'Read with the Re-read XPLAN button'
		: c.label;
	const cls = (c: SourceChip) =>
		`group inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition
		${c.state === 'ok' ? 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-850' : ''}
		${c.state === 'warn' ? 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300' : ''}
		${c.state === 'off' ? 'border-dashed border-gray-300 text-gray-500 dark:border-gray-600' : ''}
		${c.action ? 'hover:bg-gray-100 dark:hover:bg-gray-800' : 'cursor-default'}`;
</script>

<div class="flex flex-wrap items-center gap-2">
	{#each chips as c (c.source)}
		<svelte:element this={c.action ? 'a' : 'span'} href={c.action ? CONNECTIONS_HREF : undefined} title={hint(c)} class={cls(c)}>
			<span class="w-2 h-2 rounded-full {c.state === 'off' ? 'opacity-40' : ''}" style="background:{c.color}"></span>
			<span class="font-medium">{c.label}</span>
			{#if c.state === 'ok'}
				<span class="text-gray-500">✓ {c.text}</span>
			{:else if c.action}
				<span class="{c.state === 'warn' ? '' : 'text-gray-600 dark:text-gray-300'} underline decoration-dotted underline-offset-2">{c.state === 'warn' ? `↻ ${c.text}` : c.text}</span>
			{:else}
				<span class="text-gray-500">{c.text}</span>
			{/if}
		</svelte:element>
	{/each}
</div>
