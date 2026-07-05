<script lang="ts">
	// Stage 1 · New Client Enquiry — initial contact & triage.
	// Works on the active client's LEAD record (persisted): the checklist state
	// survives reloads and the lead shows up under "New leads" on the Clients hub.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { activeClient } from '$lib/apps/activeClient';
	import { ENQUIRY_STEPS, loadLeads, upsertLead, type Lead } from '$lib/apps/leads';

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
				// Active client with no lead yet (e.g. arrived directly) — create one.
				lead = { id: c.id, name: c.name, createdAt: nowIso(), stage: 'enquiry', enquiry: {} };
				await upsertLead(token(), lead);
			}
		} catch (e) {
			console.warn('Could not load/create lead:', e);
		}
		loading = false;
	});

	const toggle = async (id: string) => {
		if (!lead) return;
		lead = { ...lead, enquiry: { ...lead.enquiry, [id]: !lead.enquiry[id] } };
		try {
			await upsertLead(token(), lead);
		} catch (e) {
			console.warn('Could not save lead progress:', e);
		}
	};

	$: completed = lead ? ENQUIRY_STEPS.filter((s) => lead.enquiry?.[s.id]).length : 0;
	$: allDone = lead ? completed === ENQUIRY_STEPS.length : false;
</script>

<div class="max-w-3xl mx-auto px-8 py-10">
	{#if loading}
		<p class="text-sm text-gray-500">Loading…</p>
	{:else if !lead}
		<div class="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 p-8 text-center">
			<p class="text-sm font-medium">No client selected</p>
			<p class="text-sm text-gray-500 mt-1 mb-4">Create or pick a client on the Clients hub to start an enquiry.</p>
			<button
				on:click={() => goto('/apps/clients')}
				class="inline-flex rounded-xl bg-black text-white dark:bg-white dark:text-black px-4 py-2.5 text-sm font-medium hover:opacity-90 transition"
			>
				Go to Clients
			</button>
		</div>
	{:else}
		<div class="mb-8">
			<p class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Stage 1 · New Client Enquiry</p>
			<h1 class="text-2xl font-semibold tracking-tight mt-1">{lead.name}</h1>
			<p class="text-sm text-gray-500 mt-1">Initial contact &amp; triage — {completed}/{ENQUIRY_STEPS.length} done.</p>
		</div>

		<div class="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
			{#each ENQUIRY_STEPS as s}
				<label class="flex items-start gap-3 px-4 py-3.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-850 transition">
					<input
						type="checkbox"
						checked={!!lead.enquiry?.[s.id]}
						on:change={() => toggle(s.id)}
						class="mt-0.5 size-4 rounded accent-black dark:accent-white"
					/>
					<div class="min-w-0">
						<p class="text-sm font-medium {lead.enquiry?.[s.id] ? 'line-through text-gray-400' : ''}">{s.title}</p>
						<p class="text-xs text-gray-500 mt-0.5">{s.detail}</p>
					</div>
				</label>
			{/each}
		</div>

		<div class="flex items-center justify-between gap-3 mt-5">
			<span class="text-xs text-gray-400">Lead created {new Date(lead.createdAt).toLocaleDateString()}</span>
			<button
				on:click={() => goto('/apps/discovery')}
				disabled={!allDone}
				class="rounded-xl bg-black text-white dark:bg-white dark:text-black px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-40 transition"
			>
				Continue to Discovery Meeting →
			</button>
		</div>
		{#if !allDone}
			<p class="text-xs text-gray-400 mt-3">Complete the checklist to move this lead to the Discovery Meeting.</p>
		{/if}
	{/if}
</div>
