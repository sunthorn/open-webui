<script lang="ts">
	/**
	 * Hosts a federated app's page inside the axi shell.
	 *
	 * Before this, clicking Meetings navigated the whole browser to /salem/meetings.
	 * salem then drew its own sidebar, its own user chip and a "Back to axi" link,
	 * because nothing else was on screen -- you had left axi. Same for finny.
	 *
	 * Now the row goes to /x/salem/meetings, which is an ordinary axi route. The
	 * rail and the panel stay exactly where they are and only this pane changes.
	 *
	 * A frame rather than a port: salem and finny are React, axi is SvelteKit.
	 * Rewriting their screens as axi pages is months of work; framing them is
	 * days, and every app keeps its own codebase and deploy. The gateway already
	 * serves all of them from one origin, so the session cookie just works and
	 * this page can read the frame's location to keep the address bar honest.
	 *
	 * `embed=1` tells the app to leave its own chrome out.
	 */
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { replaceState } from '$app/navigation';
	import { APPS } from '$lib/apps/menu';
	import { frameSrcFor, shellUrlFor } from '$lib/apps/clientTarget';

	let frame: HTMLIFrameElement;
	let loading = true;
	let poll: ReturnType<typeof setInterval>;

	$: appId = $page.params.app;
	$: rest = $page.params.rest ?? '';
	$: known = APPS.some((a) => a.id === appId);

	/**
	 * `$page.params.rest` is path only -- SvelteKit never folds the query
	 * string into a rest param -- so the axi URL's query (the active client
	 * AND any deep link such as ?meeting=, ?note=, ?tab=) is re-attached here
	 * by hand, or the frame never sees it at all.
	 *
	 * /x/salem/meetings?meeting=m1&client=C -> /salem/meetings?embed=1&meeting=m1&client=C
	 */
	$: src = known ? frameSrcFor(appId, rest, $page.url.search) : '';

	/**
	 * Keep axi's address bar in step with the frame -- path, the frame's own
	 * query (minus embed/client) AND client. The client is not reliably in the
	 * frame's URL (salem reads it once from ?client= and then routes
	 * internally), so it is re-attached from the axi URL; dropping it made a
	 * reload inside salem lose the scope (spec 2026-10-08 §3.2).
	 *
	 * Compared against window.location, not $page.url: replaceState does not
	 * update $page.url, so comparing with it would re-fire every poll. `src`
	 * reads $page.url, which therefore stays put and never reloads the frame.
	 *
	 * Same origin, so the frame's location is readable. Polling rather than
	 * listening: an SPA inside the frame changes its URL with pushState, which
	 * fires no event the parent can hear.
	 */
	const syncUrl = () => {
		try {
			const inner = frame?.contentWindow?.location;
			if (!inner || !appId) return;
			const innerPath = inner.pathname.replace(new RegExp(`^/${appId}/?`), '');
			const want = shellUrlFor(
				appId,
				innerPath,
				$page.url.searchParams.get('client'),
				inner.search
			);
			if (want !== `${window.location.pathname}${window.location.search}`) {
				replaceState(want, {});
			}
		} catch {
			// A cross-origin frame would throw here. Nothing in axi is cross-origin
			// today; if that changes, the address bar simply stops following.
		}
	};

	onMount(() => {
		poll = setInterval(syncUrl, 400);
	});
	onDestroy(() => clearInterval(poll));
</script>

<svelte:head>
	<title>{APPS.find((a) => a.id === appId)?.label ?? 'axi'}</title>
</svelte:head>

<div class="relative w-full h-full">
	{#if !known}
		<div class="w-full h-full flex items-center justify-center text-sm text-gray-500">
			Unknown app: {appId}
		</div>
	{:else}
		{#if loading}
			<div
				class="absolute inset-0 flex items-center justify-center text-sm text-gray-400 dark:text-gray-600"
			>
				Loading…
			</div>
		{/if}
		<iframe
			bind:this={frame}
			{src}
			title={APPS.find((a) => a.id === appId)?.label ?? 'app'}
			on:load={() => {
				loading = false;
				syncUrl();
			}}
			class="w-full h-full border-0 block"
		></iframe>
	{/if}
</div>
