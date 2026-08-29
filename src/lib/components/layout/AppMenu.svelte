<script lang="ts">
	/**
	 * The panel beside the rail, when a federated app is selected.
	 *
	 * Renders from src/lib/apps/menu.ts rather than markup, so an app's menu is
	 * described once instead of being written twice -- the drift between the
	 * collapsed rail and the expanded panel is what this replaces.
	 *
	 * Two levels: `root` is the app's menu, `options` is its own configuration.
	 * Options always carries the sliders icon. The gear is axi's system Settings
	 * and lives in the user menu alone.
	 */
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { appById, type MenuRow } from '$lib/apps/menu';
	import { activeApp, navLevel, showSidebar, mobile } from '$lib/stores';
	import { ICON } from '$lib/apps/menu';

	$: app = appById($activeApp);
	$: rows = app ? (($navLevel === 'options' ? app.options : app.root) as MenuRow[]) : [];

	const isActive = (href: string) =>
		href && ($page.url.pathname === href || $page.url.pathname.startsWith(href + '/'));

	const open = (row: Extract<MenuRow, { kind: 'link' }>, e: MouseEvent) => {
		if (row.opensOptions) {
			e.preventDefault();
			navLevel.set('options');
			return;
		}
		// A row served by another app behind the gateway needs a real navigation.
		// goto() searches this app's routes and would find nothing.
		if (row.external) {
			if ($mobile) showSidebar.set(false);
			return; // let the anchor do it
		}
		e.preventDefault();
		goto(row.href);
		if ($mobile) showSidebar.set(false);
	};
</script>

{#if app}
	<div class="flex flex-col min-h-0 flex-1">
		<div class="flex items-center gap-2 px-3 pt-1 pb-2 mb-1 border-b border-gray-100 dark:border-gray-900">
			{#if $navLevel === 'options'}
				<button
					type="button"
					aria-label="Back to {app.label}"
					on:click={() => navLevel.set('root')}
					class="p-1 -m-1 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
						stroke-width="2.2"
						stroke="currentColor"
						class="size-4"
						aria-hidden="true"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d={ICON.back} />
					</svg>
				</button>
			{/if}
			<div class="font-medium text-sm truncate">
				{app.label}{$navLevel === 'options' ? ' Options' : ''}
			</div>
		</div>

		<div class="overflow-y-auto scrollbar-hidden flex-1 min-h-0 px-[0.4375rem]">
			{#each rows as row (row.kind === 'link' ? row.id : JSON.stringify(row))}
				{#if row.kind === 'divider'}
					<div class="h-px bg-gray-100 dark:bg-gray-900 my-2 mx-3"></div>
				{:else if row.kind === 'label'}
					<div
						class="px-3 pt-3 pb-1 text-[10px] tracking-widest uppercase text-gray-400 dark:text-gray-600 font-mono"
					>
						{row.label}
					</div>
				{:else}
					<a
						href={row.href || '#'}
						draggable="false"
						aria-label={row.label}
						aria-current={isActive(row.href) ? 'page' : undefined}
						on:click={(e) => open(row, e)}
						class="w-full flex items-center gap-3 rounded-2xl px-2.5 py-2 transition outline-none focus-visible:ring-2 focus-visible:ring-blue-500
							{isActive(row.href)
							? 'bg-gray-100 dark:bg-gray-900 font-medium'
							: 'hover:bg-gray-100 dark:hover:bg-gray-900'}"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 24 24"
							stroke-width="2"
							stroke="currentColor"
							class="size-4.5 shrink-0"
							aria-hidden="true"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d={row.icon} />
						</svg>
						<span class="flex-1 min-w-0 truncate text-sm font-primary">{row.label}</span>
						{#if row.opensOptions}
							<svg
								xmlns="http://www.w3.org/2000/svg"
								fill="none"
								viewBox="0 0 24 24"
								stroke-width="2.4"
								stroke="currentColor"
								class="size-3 shrink-0 text-gray-400 dark:text-gray-600"
								aria-hidden="true"
							>
								<path stroke-linecap="round" stroke-linejoin="round" d={ICON.chevron} />
							</svg>
						{/if}
					</a>
				{/if}
			{/each}
		</div>
	</div>
{/if}
