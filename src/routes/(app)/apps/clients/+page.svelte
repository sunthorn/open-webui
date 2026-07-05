<script lang="ts">
	// Clients — the hub for choosing who the planner works on. Search or create a
	// client; quick-pick from Recent and Needs-attention. Selecting sets the
	// global active client and jumps to the right stage (new → Enquiry,
	// existing → Data Entry).
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getBriefing } from '$lib/apis/gateway';
	import { activeClient, recentClients, setActiveClient } from '$lib/apps/activeClient';
	import { loadLeads, upsertLead, enquiryProgress, ENQUIRY_STEPS, type Lead } from '$lib/apps/leads';

	let query = '';
	let attention: string[] = []; // client names surfaced from the briefing
	let leads: Lead[] = [];

	const token = () => localStorage.getItem('token') ?? '';

	onMount(async () => {
		try {
			const b = await getBriefing(token());
			if (b) {
				const names = [...b.needsAttention, ...b.today]
					.map((i) => i.client)
					.filter((c): c is string => !!c);
				attention = Array.from(new Set(names));
			}
		} catch (e) {
			console.warn('Could not load briefing for quick-pick:', e);
		}
		try {
			leads = await loadLeads(token());
		} catch (e) {
			console.warn('Could not load leads:', e);
		}
	});

	const nowIso = () => new Date().toISOString();
	const newId = () =>
		'lead-' + (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.round(Math.random() * 1e6)}`).slice(0, 12);

	const pickExisting = (name: string, id = '') => {
		setActiveClient({ id: id || '', name, mode: 'existing', since: nowIso() });
		goto('/apps/data-entry'); // existing → Data Entry & Research
	};

	// Creating a new client creates a persisted LEAD (Stage 1) and opens New Enquiry.
	const createNew = async () => {
		const name = query.trim();
		if (!name) return;
		const lead: Lead = { id: newId(), name, createdAt: nowIso(), stage: 'enquiry', enquiry: {} };
		try {
			leads = await upsertLead(token(), lead);
		} catch (e) {
			console.warn('Could not persist lead:', e);
		}
		setActiveClient({ id: lead.id, name, mode: 'new', since: nowIso() });
		goto('/apps/enquiry'); // new → Stage 1 New Enquiry
	};

	// Re-open an existing lead to continue its enquiry.
	const openLead = (lead: Lead) => {
		setActiveClient({ id: lead.id, name: lead.name, mode: 'new', since: nowIso() });
		goto('/apps/enquiry');
	};

	$: openLeads = leads.filter((l) => l.stage === 'enquiry');

	// Instant filter over what we can pick without a live search.
	$: q = query.trim().toLowerCase();
	$: recentFiltered = $recentClients.filter((c) => !q || c.name.toLowerCase().includes(q));
	$: attentionFiltered = attention.filter((n) => !q || n.toLowerCase().includes(q));
	$: exactExists =
		q.length > 0 &&
		($recentClients.some((c) => c.name.toLowerCase() === q) || attention.some((n) => n.toLowerCase() === q));
</script>

<div class="max-w-3xl mx-auto px-8 py-10">
	<div class="mb-6">
		<h1 class="text-2xl font-semibold tracking-tight">Clients</h1>
		<p class="text-sm text-gray-500 mt-1">Search for a client to work on, or create a new one.</p>
	</div>

	<!-- Search / create -->
	<div class="relative mb-3">
		<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor" class="size-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
			<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
		</svg>
		<input
			bind:value={query}
			placeholder="Search by client name, or type a new client’s name…"
			class="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 pl-11 pr-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10"
			on:keydown={(e) => e.key === 'Enter' && q && !exactExists && createNew()}
		/>
	</div>

	<!-- Create-new affordance when the typed name isn't an existing pick -->
	{#if q && !exactExists}
		<button
			on:click={createNew}
			class="w-full flex items-center gap-3 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 px-4 py-3 text-sm hover:bg-gray-50 dark:hover:bg-gray-850 transition mb-6"
		>
			<span class="size-8 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 flex items-center justify-center text-lg leading-none">+</span>
			<span>Create new client “<span class="font-medium">{query.trim()}</span>” → start a New Enquiry</span>
		</button>
	{/if}

	<!-- Recent -->
	{#if recentFiltered.length}
		<section class="mb-6">
			<h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Recent</h2>
			<div class="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
				{#each recentFiltered as c}
					<button
						on:click={() => pickExisting(c.name, c.id)}
						class="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-850 transition"
					>
						<span class="size-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs font-semibold">
							{c.name.slice(0, 1).toUpperCase()}
						</span>
						<span class="flex-1 min-w-0 truncate {$activeClient && $activeClient.name === c.name ? 'font-semibold' : ''}">{c.name}</span>
						{#if c.mode === 'new'}<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">new</span>{/if}
						{#if $activeClient && $activeClient.name === c.name}<span class="text-[10px] text-gray-400">active</span>{/if}
					</button>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Needs attention (from today's briefing) -->
	{#if attentionFiltered.length}
		<section class="mb-6">
			<h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Needs attention · from today’s briefing</h2>
			<div class="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
				{#each attentionFiltered as name}
					<button
						on:click={() => pickExisting(name)}
						class="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-850 transition"
					>
						<span class="size-1.5 rounded-full bg-red-500 shrink-0"></span>
						<span class="flex-1 min-w-0 truncate">{name}</span>
					</button>
				{/each}
			</div>
		</section>
	{/if}

	<!-- New leads — prospects created at Stage 1 (New Enquiry) -->
	<section>
		<h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">New leads</h2>
		{#if openLeads.filter((l) => !q || l.name.toLowerCase().includes(q)).length}
			<div class="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
				{#each openLeads.filter((l) => !q || l.name.toLowerCase().includes(q)) as lead}
					<button
						on:click={() => openLead(lead)}
						class="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-850 transition"
					>
						<span class="size-8 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 flex items-center justify-center text-xs font-semibold">
							{lead.name.slice(0, 1).toUpperCase()}
						</span>
						<span class="flex-1 min-w-0 truncate">{lead.name}</span>
						<span class="text-xs text-gray-400 tabular-nums">{enquiryProgress(lead)}/{ENQUIRY_STEPS.length} enquiry</span>
					</button>
				{/each}
			</div>
		{:else}
			<div class="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 px-4 py-5 text-center">
				<p class="text-sm text-gray-500">No new leads yet. Type a new client’s name above to create one.</p>
			</div>
		{/if}
	</section>

	{#if !recentFiltered.length && !attentionFiltered.length && !q}
		<p class="text-xs text-gray-400 mt-6">
			No recent clients yet. Search a name, or type a new client’s name to create one.
			Full XPLAN search comes with the live client lookup.
		</p>
	{/if}
</div>
