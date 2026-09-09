<script lang="ts">
	/**
	 * Switch client without leaving the page.
	 *
	 * The bar used to send you to /apps/clients to change client. That was fine
	 * while the bar only existed inside xPlan; now that Documents and Meetings
	 * carry it, bouncing means leaving the app you are working in — and, because
	 * those apps are framed, paying a full React reload to come back.
	 *
	 * /apps/clients is still the client BOOK: archived filters, sharing, new
	 * clients, CSV import. This only switches.
	 *
	 * Search here MUST hit the synced book (`listClients`), not
	 * GET /gw/clients/search-live: search_live() (contact-layer/app/
	 * factfind.py) reads its id from /resourceful/entity, an id space that
	 * has never been shown to equal the book sweep's checkbox value — the
	 * one that (contact-layer/app/cdp.py:164-170) is the true individual id,
	 * while the row's data-entity-id is the HOUSEHOLD id and drops one
	 * partner from every couple if used instead (data-layer/app/models.py:
	 * 74-76). listClients returns exactly the id the Clients page selects
	 * with, so both controls agree by construction; search-live's id has no
	 * such guarantee and picking the same person from here and from the
	 * Clients page could silently yield two different active-client ids.
	 */
	import { createEventDispatcher, onMount, onDestroy } from 'svelte';
	import { recentClients, setActiveClient } from '$lib/apps/activeClient';
	import { mergeRows, type PickerRow } from '$lib/apps/clientSearch';
	import { listClients } from '$lib/apis/gateway';

	const dispatch = createEventDispatcher<{ close: void }>();

	let query = '';
	let results: { id: string; name: string }[] = [];
	let input: HTMLInputElement;
	let root: HTMLDivElement;
	let timer: ReturnType<typeof setTimeout>;
	let seq = 0;
	/** Distinct from "no matching clients" — the request itself failed. */
	let searchFailed = false;

	const handleClickOutside = (e: MouseEvent) => {
		if (root && !root.contains(e.target as Node)) dispatch('close');
	};

	onMount(() => {
		input?.focus();
		// Attached in onMount, which Svelte runs on the next microtask after
		// `picking = true` — after the click that set it has finished
		// dispatching — so the click that opened the picker is never seen by
		// this listener and can't immediately close it.
		window.addEventListener('click', handleClickOutside);
	});
	onDestroy(() => window.removeEventListener('click', handleClickOutside));

	// Debounced, and sequence-guarded: a slow response for "ab" must not
	// overwrite a fast one for "abbey".
	const onInput = () => {
		clearTimeout(timer);
		const mine = ++seq;
		const q = query.trim();
		searchFailed = false;
		if (!q) {
			results = [];
			return;
		}
		timer = setTimeout(async () => {
			try {
				// 20 is plenty for a type-ahead; the same mapping the Clients
				// page uses (xplanClientId -> id) so results and recents share
				// one id space.
				const found = await listClients(localStorage.getItem('token') ?? '', q, 20);
				if (mine === seq) {
					results = found.clients.map((c) => ({ id: c.xplanClientId, name: c.name }));
				}
			} catch {
				if (mine === seq) {
					results = [];
					searchFailed = true;
				}
			}
		}, 200);
	};

	const choose = (row: PickerRow) => {
		setActiveClient({
			id: row.id,
			name: row.name,
			mode: 'existing',
			since: new Date().toISOString()
		});
		dispatch('close');
	};

	$: rows = mergeRows($recentClients, results, query);
</script>

<svelte:window on:keydown={(e) => e.key === 'Escape' && dispatch('close')} />

<div
	bind:this={root}
	class="absolute right-0 top-full mt-1 w-80 max-h-96 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1"
>
	<div class="px-2 py-1">
		<input
			bind:this={input}
			bind:value={query}
			on:input={onInput}
			placeholder="Search clients…"
			class="w-full px-2 py-1.5 text-sm rounded-lg bg-gray-50 dark:bg-gray-850 outline-none"
		/>
	</div>
	{#each rows as row (row.id)}
		<button
			on:click={() => choose(row)}
			class="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-850 flex items-center gap-2"
		>
			<span class="truncate">{row.name}</span>
			{#if row.recent}
				<span class="ml-auto shrink-0 text-[10px] text-gray-400">recent</span>
			{/if}
		</button>
	{:else}
		<p
			class="px-3 py-2 text-sm {searchFailed ? 'text-red-500 dark:text-red-400' : 'text-gray-500'}"
		>
			{searchFailed
				? 'Search failed — try again'
				: query.trim()
					? 'No matching clients'
					: 'Search for a client'}
		</p>
	{/each}
</div>
