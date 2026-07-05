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
			href: '/apps/onboarding',
			icon: 'M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z'
		},
		{
			id: 'clients',
			label: 'Client Lookup',
			href: null,
			icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
		},
		{
			id: 'briefing',
			label: 'Briefing',
			href: '/apps/briefing',
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
	aria-label="xplan apps"
	class="min-w-[4.5rem] w-[4.5rem] shrink-0 h-full bg-gray-50 dark:bg-gray-950 border-r border-gray-100 dark:border-gray-900 flex flex-col items-center gap-1 pt-4"
>
	<!-- xplan brand monogram -->
	<Tooltip content="xplan" placement="right">
		<a
			href="/apps/overview"
			aria-label="xplan home"
			class="size-11 rounded-2xl bg-black dark:bg-white text-white dark:text-black flex items-center justify-center font-semibold tracking-tight select-none"
		>
			xp
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

	<!-- bottom group: settings + exit -->
	<div class="mt-auto mb-4 flex flex-col items-center gap-1 w-full">
		<Tooltip content="Settings" placement="right">
			<a
				href="/apps/settings"
				aria-label="Settings"
				class="size-11 flex items-center justify-center rounded-2xl {$page.url.pathname.startsWith(
					'/apps/settings'
				)
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
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
					/>
					<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
				</svg>
			</a>
		</Tooltip>
		<Tooltip content="Back to Open WebUI" placement="right">
			<a
				href="/"
				aria-label="Back to Open WebUI"
				class="size-11 flex items-center justify-center rounded-2xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-900"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
					stroke-width="1.7"
					stroke="currentColor"
					class="size-5"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
					/>
				</svg>
			</a>
		</Tooltip>
	</div>
</nav>
