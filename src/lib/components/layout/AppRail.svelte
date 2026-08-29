<script lang="ts">
	/**
	 * The axi rail: the axi mark, then one icon per federated app.
	 *
	 * Promoted out of lib/components/apps/AppsRail.svelte, which rendered this
	 * same rail but only inside /apps and only for xPlan. Here it sits at the
	 * layout level and carries every tenant, so switching between them is one
	 * click and the panel beside it changes rather than the whole page.
	 *
	 * Selecting an app only changes what the panel shows. Navigation happens
	 * when a row in the panel is clicked, not when the rail is.
	 */
	import { page } from '$app/stores';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import { APPS, appForPath, ICON } from '$lib/apps/menu';
	import { activeApp, navLevel, showSidebar, mobile } from '$lib/stores';

	/**
	 * Follow the URL, so a deep link or a reload lands on the right app.
	 *
	 * Guarded on the pathname rather than written as a plain reactive block. A
	 * `$:` that reads $activeApp re-runs when $activeApp changes, so clicking a
	 * rail icon set the app, re-ran the block, found the URL still on axi, and
	 * set it straight back to null — the rail looked completely dead.
	 *
	 * Comparing against syncedPath means this fires only when the path actually
	 * moves. A rail click changes no path, so it cannot feed back into itself.
	 */
	let syncedPath = '';
	$: {
		const path = $page.url.pathname;
		if (path !== syncedPath) {
			syncedPath = path;
			activeApp.set(appForPath(path)?.id ?? null);
			navLevel.set('root');
		}
	}

	const select = (id: string | null) => {
		activeApp.set(id);
		navLevel.set('root');
		// Collapsed, the rail is all there is. Picking something should show it,
		// otherwise the click has no visible effect at all.
		if (!$mobile && !$showSidebar) showSidebar.set(true);
	};
</script>

<nav
	aria-label="axi apps"
	class="w-14 shrink-0 h-full flex flex-col items-center gap-1 pt-3 pb-3 border-r border-gray-100 dark:border-gray-900 bg-gray-50 dark:bg-gray-950"
>
	<!-- The mark, above the line: a logo, and it behaves like one. Clicking it
	     goes home. It is deliberately NOT the axi nav button — that sits below
	     the line with the others, because a logo and a tab are different things
	     and making one object do both is what made this read as undecided. -->
	<Tooltip content="axi" placement="right">
		<a
			href="/"
			aria-label="axi home"
			class="size-9 rounded-xl bg-black dark:bg-white text-white dark:text-black flex items-center justify-center font-semibold text-[13px] tracking-tight select-none outline-none focus-visible:ring-2 focus-visible:ring-blue-500 shrink-0"
		>
			ax
		</a>
	</Tooltip>

	<div class="border-t border-gray-100 dark:border-gray-900 w-7 my-2"></div>

	<!-- Below the line every entry is a tab, axi included, and they all look and
	     behave alike: same size, same hover, same selected treatment. -->
	<div class="relative w-full flex justify-center">
		{#if $activeApp === null}
			<div
				class="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r bg-black dark:bg-white"
			></div>
		{/if}
		<Tooltip content="Chat" placement="right">
			<button
				type="button"
				aria-label="Chat"
				aria-current={$activeApp === null ? 'true' : undefined}
				on:click={() => select(null)}
				class="size-9 flex items-center justify-center rounded-xl transition outline-none focus-visible:ring-2 focus-visible:ring-blue-500
					{$activeApp === null
					? 'bg-gray-200 dark:bg-gray-800 text-black dark:text-white'
					: 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-900'}"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
					stroke-width="1.7"
					stroke="currentColor"
					class="size-[18px]"
					aria-hidden="true"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d={ICON.chat} />
				</svg>
			</button>
		</Tooltip>
	</div>

	{#each APPS as app (app.id)}
		<div class="relative w-full flex justify-center">
			{#if $activeApp === app.id}
				<div class="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r bg-black dark:bg-white"></div>
			{/if}
			<Tooltip content={app.label} placement="right">
				<button
					type="button"
					aria-label={app.label}
					aria-current={$activeApp === app.id ? 'true' : undefined}
					on:click={() => select(app.id)}
					class="size-9 flex items-center justify-center rounded-xl transition outline-none focus-visible:ring-2 focus-visible:ring-blue-500
						{$activeApp === app.id
						? 'bg-gray-200 dark:bg-gray-800 text-black dark:text-white'
						: 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-900'}"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
						stroke-width="1.7"
						stroke="currentColor"
						class="size-[18px]"
						aria-hidden="true"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d={app.icon} />
					</svg>
				</button>
			</Tooltip>
		</div>
	{/each}
</nav>
