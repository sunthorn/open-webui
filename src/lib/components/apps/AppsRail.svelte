<script lang="ts">
	// xplan-agent app rail — the left "app switcher" for the planner dashboard.
	// Self-contained: does not touch Open WebUI's Electron AppSidebar or the
	// main chat Sidebar. Overview is live; the rest are stubs ("coming soon")
	// for Slice 1.
	import { page } from '$app/stores';
	import Tooltip from '$lib/components/common/Tooltip.svelte';

	// Each app: id, label, href (null = not built yet), and an inline icon path.
	const apps = [
		{
			id: 'overview',
			label: 'Overview',
			href: '/apps/overview',
			icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6'
		},
		{
			id: 'onboarding',
			label: 'New Client Onboarding',
			href: null,
			icon: 'M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z'
		},
		{
			id: 'clients',
			label: 'Client Lookup',
			href: null,
			icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
		},
		{
			id: 'activity',
			label: 'Activity / Audit',
			href: null,
			icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4'
		},
		{
			id: 'opportunity',
			label: 'Opportunity',
			href: null,
			icon: 'M13 10V3L4 14h7v7l9-11h-7z'
		}
	];

	$: activeId = apps.find((a) => a.href && $page.url.pathname.startsWith(a.href))?.id ?? '';
</script>

<nav
	aria-label="xplan-agent apps"
	class="min-w-[4.5rem] w-[4.5rem] shrink-0 h-full bg-gray-50 dark:bg-gray-950 border-r border-gray-100 dark:border-gray-900 flex flex-col items-center gap-1 pt-4"
>
	<!-- xplan-agent brand monogram -->
	<Tooltip content="xplan-agent" placement="right">
		<a
			href="/apps/overview"
			aria-label="xplan-agent home"
			class="size-11 rounded-2xl bg-black dark:bg-white text-white dark:text-black flex items-center justify-center font-semibold tracking-tight select-none"
		>
			xa
		</a>
	</Tooltip>

	<div class="border-[1.5px] border-gray-100 dark:border-gray-900 mx-4 w-8 my-3"></div>

	{#each apps as app}
		<div class="flex justify-center relative w-full">
			{#if activeId === app.id}
				<div class="absolute top-0 left-0 flex h-full">
					<div class="my-auto rounded-r-lg w-1 h-8 bg-black dark:bg-white"></div>
				</div>
			{/if}

			<Tooltip content={app.href ? app.label : `${app.label} — coming soon`} placement="right">
				{#if app.href}
					<a
						href={app.href}
						aria-label={app.label}
						class="size-11 flex items-center justify-center rounded-2xl transition
							{activeId === app.id
							? 'bg-gray-200 dark:bg-gray-800 text-black dark:text-white'
							: 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-900'}"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 24 24"
							stroke-width="1.7"
							stroke="currentColor"
							class="size-5"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d={app.icon} />
						</svg>
					</a>
				{:else}
					<button
						disabled
						aria-label={`${app.label} (coming soon)`}
						class="size-11 flex items-center justify-center rounded-2xl text-gray-300 dark:text-gray-700 cursor-not-allowed"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 24 24"
							stroke-width="1.7"
							stroke="currentColor"
							class="size-5"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d={app.icon} />
						</svg>
					</button>
				{/if}
			</Tooltip>
		</div>
	{/each}
</nav>
