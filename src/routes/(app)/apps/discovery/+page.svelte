<script lang="ts">
	// Stage 2 · Discovery Meeting — understand the client.
	// Works on the active client's lead record (persisted). Advances the lead's
	// stage enquiry → discovery on arrival, so it moves down the pipeline.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { activeClient } from '$lib/apps/activeClient';
	import { DISCOVERY_STEPS, countDone, loadLeads, upsertLead, type Lead } from '$lib/apps/leads';

	let lead: Lead | null = null;
	let loading = true;

	const token = () => localStorage.getItem('token') ?? '';
	const nowIso = () => new Date().toISOString();

	onMount(async () => {
		const c = $activeClient;
		if (!c) {
			loading = false;
			return;
		}
		try {
			const leads = await loadLeads(token());
			lead = leads.find((l) => l.id === c.id) ?? null;
			if (!lead) {
				lead = { id: c.id, name: c.name, createdAt: nowIso(), stage: 'discovery', enquiry: {}, discovery: {} };
				await upsertLead(token(), lead);
			} else if (lead.stage === 'enquiry') {
				// Reaching discovery advances the lead out of "New leads".
				lead = { ...lead, stage: 'discovery', discovery: lead.discovery ?? {} };
				await upsertLead(token(), lead);
			}
		} catch (e) {
			console.warn('Could not load/create lead:', e);
		}
		loading = false;
	});

	const toggle = async (id: string) => {
		if (!lead) return;
		lead = { ...lead, discovery: { ...(lead.discovery ?? {}), [id]: !lead.discovery?.[id] } };
		try {
			await upsertLead(token(), lead);
		} catch (e) {
			console.warn('Could not save discovery progress:', e);
		}
	};

	const continueToDataEntry = async () => {
		if (lead) {
			lead = { ...lead, stage: 'data-entry' };
			try {
				await upsertLead(token(), lead);
			} catch (e) {
				console.warn('Could not advance lead:', e);
			}
		}
		goto('/apps/data-entry');
	};

	$: completed = lead ? countDone(DISCOVERY_STEPS, lead.discovery) : 0;
	$: allDone = completed === DISCOVERY_STEPS.length;
</script>

<div class="max-w-3xl mx-auto px-8 py-10">
	{#if loading}
		<p class="text-sm text-gray-500">Loading…</p>
	{:else if !lead}
		<div class="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 p-8 text-center">
			<p class="text-sm font-medium">No client selected</p>
			<p class="text-sm text-gray-500 mt-1 mb-4">Pick a client on the Clients hub — Discovery works on the active client.</p>
			<button
				on:click={() => goto('/apps/clients')}
				class="inline-flex rounded-xl bg-black text-white dark:bg-white dark:text-black px-4 py-2.5 text-sm font-medium hover:opacity-90 transition"
			>
				Choose a client
			</button>
		</div>
	{:else}
		<div class="mb-8">
			<p class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Stage 2 · Discovery Meeting</p>
			<h1 class="text-2xl font-semibold tracking-tight mt-1">{lead.name}</h1>
			<p class="text-sm text-gray-500 mt-1">Understand the client — {completed}/{DISCOVERY_STEPS.length} done.</p>
		</div>

		<div class="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
			{#each DISCOVERY_STEPS as s}
				<label class="flex items-start gap-3 px-4 py-3.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-850 transition">
					<input
						type="checkbox"
						checked={!!lead.discovery?.[s.id]}
						on:change={() => toggle(s.id)}
						class="mt-0.5 size-4 rounded accent-black dark:accent-white"
					/>
					<div class="min-w-0">
						<p class="text-sm font-medium {lead.discovery?.[s.id] ? 'line-through text-gray-400' : ''}">{s.title}</p>
						<p class="text-xs text-gray-500 mt-0.5">{s.detail}</p>
					</div>
				</label>
			{/each}
		</div>

		<div class="flex items-center justify-between gap-3 mt-5">
			<button on:click={() => goto('/apps/enquiry')} class="text-sm text-gray-500 hover:text-black dark:hover:text-white">← Enquiry</button>
			<button
				on:click={continueToDataEntry}
				disabled={!allDone}
				class="rounded-xl bg-black text-white dark:bg-white dark:text-black px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-40 transition"
			>
				Continue to Data Entry &amp; Research →
			</button>
		</div>
		{#if !allDone}
			<p class="text-xs text-gray-400 mt-3">Complete discovery to move this client to Data Entry &amp; Research.</p>
		{/if}
	{/if}
</div>
