<script lang="ts">
	// One control for "what's the state of my XPLAN link?" — connection state and
	// access tier read as a single label, because they are two halves of one
	// question. Replaces the separate connection badge + access chip.
	//
	// It used to open a popover carrying the whole Connect-to-XPLAN checklist.
	// That checklist now lives on /apps/settings, which also held a second,
	// weaker writer for the same access state, so the popover and the page were
	// editing the same thing from two places. The pill is a status light you can
	// click: it reports, and sends you to the one page that changes anything.
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { getXplanStatus, getXplanAccess, accessMeta, type XplanAccessLevel } from '$lib/apis/gateway';

	/** `inline` renders as a toolbar item (apps top bar); otherwise it floats. */
	export let inline = false;

	const HREF = '/apps/settings';

	const token = () => localStorage.getItem('token') ?? '';

	let level: XplanAccessLevel = 'readonly';
	let browserUp = false;
	let loggedIn: boolean | null = null;
	let probed = false;
	// The gateway itself is unreachable (network/CORS/auth), as opposed to
	// reachable-but-reporting-a-problem. Tracked separately so the pill can say
	// so instead of vanishing.
	let unreachable = false;
	let loaded = false;

	/** On the destination page the pill would link to itself. Report only. */
	$: onSettings = $page.url.pathname === HREF;

	$: state = unreachable
		? 'unreachable'
		: !probed
		? 'checking'
		: !browserUp
			? 'browser-down'
			: loggedIn !== true
				? 'signin'
				: level === 'lock'
					? 'locked'
					: 'connected';

	$: label = {
		checking: 'Checking…',
		unreachable: "Can't reach axi",
		'browser-down': 'Browser not running',
		signin: 'Sign in to XPLAN',
		locked: 'Locked',
		connected: `Connected · ${accessMeta(level).label}`
	}[state];

	$: dot = {
		checking: 'bg-gray-400',
		unreachable: 'bg-red-500',
		'browser-down': 'bg-red-500',
		signin: 'bg-amber-500',
		locked: 'bg-amber-500',
		connected: 'bg-green-500'
	}[state];

	const refresh = async (): Promise<boolean> => {
		try {
			const [s, lvl] = await Promise.all([
				getXplanStatus(token()).catch(() => ({ browserUp: false, loggedIn: null }) as any),
				getXplanAccess(token())
			]);
			browserUp = !!s.browserUp;
			loggedIn = s.loggedIn;
			level = lvl;
			probed = true;
			unreachable = false;
			loaded = true;
			return true;
		} catch {
			return false; // token may not be ready on first paint — retried on mount
		}
	};

	const onFocus = () => {
		if (document.visibilityState === 'visible') refresh();
	};

	let timer: ReturnType<typeof setInterval> | null = null;
	onMount(async () => {
		// Auth token can 401 transiently while OWUI starts up — retry through it.
		let ok = false;
		for (let i = 0; i < 6 && !(ok = await refresh()); i++) {
			await new Promise((r) => setTimeout(r, 1000));
		}
		// Render REGARDLESS of the outcome. This block used to leave `loaded`
		// false when the calls kept failing, so the pill — the only way to reach
		// the connect page — silently removed itself from the top bar, giving the
		// planner nothing to click and no reason why.
		if (!ok) {
			unreachable = true;
			loaded = true;
		}
		timer = setInterval(refresh, 30_000);
		window.addEventListener('focus', onFocus);
		document.addEventListener('visibilitychange', onFocus);
	});
	onDestroy(() => {
		if (timer) clearInterval(timer);
		window.removeEventListener('focus', onFocus);
		document.removeEventListener('visibilitychange', onFocus);
	});

	const base =
		'inline-flex items-center gap-1.5 whitespace-nowrap font-medium transition ' +
		'text-xs px-2.5 py-1 rounded-full border ' +
		'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900';
</script>

{#if loaded}
	<div class={inline ? 'relative' : 'fixed top-1.5 right-3 z-[70]'}>
		{#if onSettings}
			<span class="{base} {inline ? '' : 'shadow-sm'} text-gray-600 dark:text-gray-300">
				<span class="size-2 rounded-full {dot}"></span>
				{label}
			</span>
		{:else}
			<a
				href={HREF}
				draggable="false"
				title="XPLAN connection and agent access"
				class="{base} hover:bg-gray-50 dark:hover:bg-gray-850 {inline ? '' : 'shadow-sm'}"
			>
				<span class="size-2 rounded-full {dot}"></span>
				{label}
			</a>
		{/if}
	</div>
{/if}
