<script lang="ts">
	// xplan-agent app rail — the left "app switcher" for the planner dashboard.
	// Self-contained: does not touch Open WebUI's Electron AppSidebar or the
	// main chat Sidebar. Overview is live; the rest are stubs ("coming soon")
	// for Slice 1.
	import { page } from '$app/stores';
	import Tooltip from '$lib/components/common/Tooltip.svelte';

	// The planner's process-flow menu. Each app: id, label, href (null = not
	// built yet), and an inline icon path. Order follows the client process:
	// Home → Search → Stage 1 → Stage 2 → Stage 3.
	const apps = [
		{
			id: 'home',
			label: 'Home',
			href: '/apps/overview',
			icon: 'M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25'
		},
		{
			id: 'clients',
			label: 'Clients',
			href: '/apps/clients',
			icon: 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z'
		},
		{
			id: 'enquiry',
			label: 'New Enquiry',
			href: '/apps/enquiry',
			icon: 'M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z'
		},
		{
			id: 'discovery',
			label: 'Discovery Meeting',
			href: '/apps/discovery',
			icon: 'M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193l-3.722.372V21l-3.9-3.9a48.9 48.9 0 01-4.023-.163c-1.133-.094-1.98-1.057-1.98-2.193V6.911c0-1.136.847-2.1 1.98-2.193a48.9 48.9 0 018.421 0c1.133.093 1.98 1.057 1.98 2.193v1.6'
		},
		{
			id: 'data-entry',
			label: 'Data Entry & Research',
			href: '/apps/data-entry',
			icon: 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z'
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
