<script lang="ts">
	/**
	 * The panel beside the rail, when a federated app is selected.
	 *
	 * Renders from src/lib/apps/menu.ts rather than markup, so an app's menu is
	 * described once instead of being written twice -- the drift between the
	 * collapsed rail and the expanded panel is what this replaces.
	 *
	 * ONE list, not two levels. Options used to be a second screen: clicking it
	 * swapped the whole panel for a "‹ xPlan Options" view and the app's own
	 * rows disappeared, so reading a setting cost you sight of everything else
	 * and getting back was a separate click. Its rows now open inline underneath
	 * it, at the same indent as the rows above, and the app's menu stays put.
	 *
	 * Options always carries the sliders icon. The gear is axi's system Settings
	 * and lives in the user menu alone.
	 */
	import { slide } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { appById, type MenuRow } from '$lib/apps/menu';
	import { activeApp, optionsOpen, showSidebar, mobile } from '$lib/stores';
	import { ICON } from '$lib/apps/menu';

	$: app = appById($activeApp);
	$: rows = (app?.root ?? []) as MenuRow[];
	$: expanded = !!app && $optionsOpen === app.id;

	const isActive = (href: string) =>
		href && ($page.url.pathname === href || $page.url.pathname.startsWith(href + '/'));

	/** The Options row is "current" while you are on any page it reveals. */
	$: optionsHasActive = !!app?.options?.some(
		(r) => r.kind === 'link' && !!r.href && isActive(r.href)
	);

	const toggleOptions = () => {
		if (!app) return;
		optionsOpen.set(expanded ? null : app.id);
	};

	const open = (row: Extract<MenuRow, { kind: 'link' }>, e: MouseEvent) => {
		if (row.opensOptions) {
			e.preventDefault();
			toggleOptions();
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
		<div
			class="flex items-center gap-2 px-3 pt-1 pb-2 mb-1 border-b border-gray-100 dark:border-gray-900"
		>
			<div class="font-medium text-sm truncate">{app.label}</div>
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
				{:else if row.opensOptions}
					<!--
						A button, not an anchor: this navigates nowhere, and an <a href="#">
						puts a junk entry in the history that Back then walks through.
					-->
					<button
						type="button"
						aria-expanded={expanded}
						aria-controls="{app.id}-options"
						on:click={(e) => open(row, e)}
						class="w-full flex items-center gap-3 rounded-2xl px-2.5 py-2 transition outline-none focus-visible:ring-2 focus-visible:ring-blue-500
							{expanded || optionsHasActive
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
						<span class="flex-1 min-w-0 truncate text-sm font-primary text-left">{row.label}</span>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 24 24"
							stroke-width="2.4"
							stroke="currentColor"
							class="size-3 shrink-0 text-gray-400 dark:text-gray-600"
							aria-hidden="true"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d={expanded ? ICON.chevronUp : ICON.chevronDown}
							/>
						</svg>
					</button>

					{#if expanded}
						<!--
							Same indent as the rows above, which is the point: these are the
							app's settings, not a nested tree. Only the reveal is new.
						-->
						<div id="{app.id}-options" transition:slide={{ duration: 180 }}>
							{#each app.options as sub (sub.kind === 'link' ? sub.id : JSON.stringify(sub))}
								{#if sub.kind === 'divider'}
									<div class="h-px bg-gray-100 dark:bg-gray-900 my-2 mx-3"></div>
								{:else if sub.kind === 'label'}
									<div
										class="px-3 pt-3 pb-1 text-[10px] tracking-widest uppercase text-gray-400 dark:text-gray-600 font-mono"
									>
										{sub.label}
									</div>
								{:else}
									<a
										href={sub.href || '#'}
										draggable="false"
										aria-label={sub.label}
										aria-current={isActive(sub.href) ? 'page' : undefined}
										on:click={(e) => open(sub, e)}
										class="w-full flex items-center gap-3 rounded-2xl px-2.5 py-2 transition outline-none focus-visible:ring-2 focus-visible:ring-blue-500
											{isActive(sub.href)
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
											<path stroke-linecap="round" stroke-linejoin="round" d={sub.icon} />
										</svg>
										<span class="flex-1 min-w-0 truncate text-sm font-primary">{sub.label}</span>
									</a>
								{/if}
							{/each}
						</div>
					{/if}
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
					</a>
				{/if}
			{/each}
		</div>
	</div>
{/if}
