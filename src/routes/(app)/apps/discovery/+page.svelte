<script lang="ts">
	// Stage 2 · Discovery Meeting — manual ticks on per-client state.
	// Plan 4 adds "Analyse what we have"; this page only reads and ticks.
	//
	// The client bar switches the active client WITHOUT remounting this page,
	// so the page reloads on a switch and every handler acts on the client it
	// LOADED (state.lead.xplanClientId), never the live store (amendment B2).
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { activeClient, linkableClientId } from '$lib/apps/activeClient';
	import { getOnboarding, setAction, setStage, type OnboardingState, type Step } from '$lib/apis/gateway/onboarding';
	import { actionMessage, byStep, doneCount } from '$lib/apps/onboarding';
	import { refreshJobs } from '$lib/stores/syncJobs';
	import XplanLink from '$lib/components/xplan/XplanLink.svelte';

	const ROWS: { step: Step; title: string; detail: string }[] = [
		{ step: 'discovery.clarify_goals', title: 'Clarify Goals', detail: 'What does the client want to achieve, and by when.' },
		{ step: 'discovery.collect_info', title: 'Collect Information', detail: 'Assets, liabilities, income, insurance, super.' },
		{ step: 'discovery.define_scope', title: 'Define Scope', detail: 'Agree what the advice will and won’t cover.' },
		{ step: 'discovery.risk_profile', title: 'Risk Profiling', detail: 'Assess risk tolerance and capacity.' }
	];

	let state: OnboardingState | null = null;
	let loading = true;
	let error = '';
	let mounted = false;
	// The client this page was last asked to show (set before the fetch, so a
	// failed load does not retry in a loop).
	let requestedFor: string | null = null;
	// Bumped on every open(): an await resuming under a newer generation
	// belongs to a client no longer on screen and must not write anything.
	let openGen = 0;
	const token = () => localStorage.getItem('token') ?? '';

	/** Read `id`'s rows. Dropped if the planner switched client meanwhile. */
	const load = async (id: string, gen: number = openGen) => {
		try {
			const next = await getOnboarding(token(), id);
			if (gen !== openGen) return;
			state = next;
			error = '';
		} catch (e) {
			if (gen !== openGen) return;
			error = actionMessage(e);
		}
		loading = false;
	};

	const open = async (id: string | null) => {
		const gen = ++openGen;
		requestedFor = id;
		state = null;
		error = '';
		if (!id) {
			loading = false;
			return;
		}
		loading = true;
		await refreshJobs(token());
		if (gen !== openGen) return;
		await load(id, gen);
	};

	onMount(() => {
		mounted = true;
	});

	// Reload whenever the active client is not the one on screen (B2).
	$: if (mounted && $linkableClientId !== requestedFor) void open($linkableClientId);

	const tick = async (step: Step, done: boolean) => {
		const gen = openGen;
		const id = state?.lead.xplanClientId;
		if (!id) return;
		try {
			await setAction(token(), id, step, done ? 'pending' : 'done');
		} catch (e) {
			if (gen === openGen) error = actionMessage(e);
		}
		if (gen !== openGen) return;
		await load(id, gen);
	};

	// A lead still at enquiry has no discovery rows yet. Moving it here is the
	// planner's call, made explicit rather than done silently on arrival.
	const moveHere = async () => {
		const gen = openGen;
		const id = state?.lead.xplanClientId;
		if (!id) return;
		try {
			await setStage(token(), id, 'discovery');
		} catch (e) {
			if (gen === openGen) error = actionMessage(e);
		}
		if (gen !== openGen) return;
		await load(id, gen);
	};

	const continueToDataEntry = async () => {
		const gen = openGen;
		const id = state?.lead.xplanClientId;
		if (!id) return;
		try {
			await setStage(token(), id, 'data_entry');
			if (gen === openGen) goto('/apps/data-entry');
		} catch (e) {
			if (gen === openGen) error = actionMessage(e);
		}
	};

	$: actions = state?.actions ?? [];
	$: map = byStep(actions);
	$: atEnquiry = state?.lead.stage === 'enquiry';
	$: completed = doneCount(actions, 'discovery');
	$: allDone = completed === ROWS.length;
</script>

<div class="max-w-3xl mx-auto px-8 py-10">
	{#if !$linkableClientId || !$activeClient}
		<div class="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 p-8 text-center">
			<p class="text-sm font-medium">No client selected</p>
			<p class="text-sm text-gray-500 mt-1 mb-4">Pick a client on the Clients hub — Discovery works on the active client.</p>
			<button on:click={() => goto('/apps/clients')} class="inline-flex rounded-xl bg-black text-white dark:bg-white dark:text-black px-4 py-2.5 text-sm font-medium hover:opacity-90 transition">Choose a client</button>
		</div>
	{:else if loading}
		<p class="text-sm text-gray-500">Loading…</p>
	{:else if !state}
		<p class="text-sm text-red-600 dark:text-red-400">{error || 'Could not load this client.'}</p>
	{:else}
		<div class="mb-8 flex items-start justify-between gap-4">
			<div>
				<p class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Stage 2 · Discovery Meeting</p>
				<h1 class="text-2xl font-semibold tracking-tight mt-1">{$activeClient.name}</h1>
				<p class="text-sm text-gray-500 mt-1">Understand the client — {completed}/{ROWS.length} done.</p>
			</div>
			<XplanLink path={`/factfind/view/${state.lead.xplanClientId}?role=client`} label="Fact Find" size="md" title="Open this client's Fact Find in XPLAN" />
		</div>
		{#if error}<p class="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>{/if}

		{#if atEnquiry}
			<div class="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 p-6 text-center">
				<p class="text-sm">This client is still at Stage 1.</p>
				<div class="flex justify-center gap-2 mt-3">
					<button on:click={() => goto('/apps/enquiry')} class="text-sm px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-850 transition">← Finish the enquiry</button>
					<button on:click={moveHere} class="text-sm px-3 py-2 rounded-xl bg-black text-white dark:bg-white dark:text-black hover:opacity-90 transition">Move to Discovery anyway</button>
				</div>
			</div>
		{:else}
			<div class="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
				{#each ROWS as s}
					{@const done = map.get(s.step)?.status === 'done'}
					<label class="flex items-start gap-3 px-4 py-3.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-850 transition">
						<input type="checkbox" checked={done} on:change={() => tick(s.step, done)} class="mt-0.5 size-4 rounded accent-black dark:accent-white" />
						<div class="min-w-0">
							<p class="text-sm font-medium {done ? 'line-through text-gray-400' : ''}">{s.title}</p>
							<p class="text-xs text-gray-500 mt-0.5">{s.detail}</p>
						</div>
					</label>
				{/each}
			</div>
			<div class="flex items-center justify-between gap-3 mt-5">
				<button on:click={() => goto('/apps/enquiry')} class="text-sm text-gray-500 hover:text-black dark:hover:text-white">← Enquiry</button>
				<button on:click={continueToDataEntry} disabled={!allDone} class="rounded-xl bg-black text-white dark:bg-white dark:text-black px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-40 transition">Continue to Data Entry &amp; Research →</button>
			</div>
			{#if !allDone}<p class="text-xs text-gray-400 mt-3">Complete discovery to move this client to Data Entry &amp; Research.</p>{/if}
		{/if}
	{/if}
</div>
