<script lang="ts">
	// One control for "what's the state of my XPLAN link?" — connection state and
	// access tier in a single pill, because they are two halves of one question.
	// Replaces the separate connection badge + access chip.
	import { onMount, onDestroy } from 'svelte';
	import {
		getXplanStatus,
		getXplanAccess,
		relaunchDebugBrowser,
		accessMeta,
		type XplanAccessLevel
	} from '$lib/apis/gateway';
	import XplanAccessControl from './XplanAccessControl.svelte';

	/** `inline` renders as a toolbar item (apps top bar); otherwise it floats. */
	export let inline = false;

	const token = () => localStorage.getItem('token') ?? '';

	let level: XplanAccessLevel = 'readonly';
	let browserUp = false;
	let loggedIn: boolean | null = null;
	let probed = false;
	let loaded = false;
	let open = false;
	let reopening = false;
	let reopenErr = '';

	// Checklist step states (the "Connect to XPLAN" panel now lives in this popover).
	$: step1 = !probed ? 'unknown' : browserUp ? 'ok' : 'todo';
	$: step2 = loggedIn === true ? 'ok' : loggedIn === false ? 'fail' : 'unknown';

	$: state = !probed
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
		'browser-down': 'Browser not running',
		signin: 'Sign in to XPLAN',
		locked: 'Locked',
		connected: `Connected · ${accessMeta(level).label}`
	}[state];

	$: dot = {
		checking: 'bg-gray-400',
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
			loaded = true;
			return true;
		} catch {
			return false; // token may not be ready on first paint — retried on mount
		}
	};

	const reopen = async () => {
		if (reopening) return;
		reopening = true;
		reopenErr = '';
		try {
			await relaunchDebugBrowser(token());
			for (let i = 0; i < 8 && !browserUp; i++) {
				await new Promise((r) => setTimeout(r, 1500));
				await refresh();
			}
		} catch (e: any) {
			reopenErr = typeof e === 'string' ? e : (e?.message ?? 'Could not reopen the browser');
		} finally {
			reopening = false;
		}
	};

	const onFocus = () => {
		if (document.visibilityState === 'visible') refresh();
	};

	let timer: ReturnType<typeof setInterval> | null = null;
	onMount(async () => {
		// Auth token can 401 transiently while OWUI starts up — retry through it.
		for (let i = 0; i < 6 && !(await refresh()); i++) {
			await new Promise((r) => setTimeout(r, 1000));
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
</script>

{#if loaded}
	<!-- Floating mode must out-rank the apps shell (a full-screen overlay at
	     z-[60] in (app)/apps/+layout.svelte). Inline mode sits in its top bar. -->
	<div class={inline ? 'relative' : 'fixed top-1.5 right-3 z-[70]'}>
		<button
			type="button"
			on:click={() => (open = !open)}
			title="XPLAN connection and agent access"
			class="inline-flex items-center gap-1.5 whitespace-nowrap font-medium transition
				text-xs px-2.5 py-1 rounded-full border
				border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900
				hover:bg-gray-50 dark:hover:bg-gray-850
				{inline ? '' : 'shadow-sm'}"
		>
			<span class="size-2 rounded-full {dot}"></span>
			{label}
			<span class="text-gray-400 text-[10px]">▾</span>
		</button>

		{#if open}
			<!-- The whole "Connect to XPLAN" checklist lives here so it's reachable
			     from every page, not just the overview. Anchors under the pill. -->
			<div
				class="absolute {inline ? 'left-0' : 'right-0'} top-full mt-1.5 z-[80] w-80 p-4
					rounded-xl border border-gray-200 dark:border-gray-700
					bg-white dark:bg-gray-900 shadow-xl text-left"
			>
				<div class="flex items-center gap-2 mb-1">
					<span class="size-2 rounded-full {dot}"></span>
					<span class="text-sm font-semibold">Connect to XPLAN</span>
				</div>
				<p class="text-[11px] text-gray-500 mb-3">
					Checking the connection is free — only refreshing uses the AI.
				</p>

				<ol class="space-y-3">
					<!-- 1 · debug browser -->
					<li class="flex gap-2.5">
						<span
							class="mt-0.5 shrink-0 size-4 rounded-full flex items-center justify-center text-[9px] font-semibold
								{step1 === 'ok'
								? 'bg-green-500 text-white'
								: step1 === 'todo'
									? 'bg-amber-500 text-white'
									: 'bg-gray-200 dark:bg-gray-700 text-gray-500'}"
						>
							{step1 === 'ok' ? '✓' : '1'}
						</span>
						<div class="min-w-0 flex-1">
							<p class="text-xs font-medium">Debug browser</p>
							{#if step1 !== 'ok'}
								<p class="text-[11px] text-gray-500 mt-0.5">
									It normally reopens on its own. If not, reopen it here.
								</p>
								<button
									type="button"
									on:click={reopen}
									disabled={reopening}
									class="mt-1.5 text-[11px] font-medium px-2 py-1 rounded-lg border
										border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-850 disabled:opacity-50"
								>
									{reopening ? 'Reopening…' : 'Reopen debug browser'}
								</button>
								{#if reopenErr}
									<p class="text-[11px] text-red-600 dark:text-red-400 mt-1">{reopenErr}</p>
								{/if}
							{/if}
						</div>
					</li>

					<!-- 2 · sign in -->
					<li class="flex gap-2.5">
						<span
							class="mt-0.5 shrink-0 size-4 rounded-full flex items-center justify-center text-[9px] font-semibold
								{step2 === 'ok'
								? 'bg-green-500 text-white'
								: step2 === 'fail'
									? 'bg-amber-500 text-white'
									: 'bg-gray-200 dark:bg-gray-700 text-gray-500'}"
						>
							{step2 === 'ok' ? '✓' : '2'}
						</span>
						<div class="min-w-0 flex-1">
							<p class="text-xs font-medium">Sign in to XPLAN</p>
							{#if step2 !== 'ok'}
								<p class="text-[11px] text-gray-500 mt-0.5">
									{step2 === 'fail'
										? 'The browser is up but not on a signed-in XPLAN page — log in in that window.'
										: 'Open XPLAN in the debug window and sign in — your session stays there.'}
								</p>
							{/if}
						</div>
					</li>

					<!-- 3 · access tier -->
					<li class="flex gap-2.5">
						<span
							class="mt-0.5 shrink-0 size-4 rounded-full flex items-center justify-center text-[9px] font-semibold
								{level !== 'lock'
								? 'bg-green-500 text-white'
								: 'bg-gray-200 dark:bg-gray-700 text-gray-500'}"
						>
							{level !== 'lock' ? '✓' : '3'}
						</span>
						<div class="min-w-0 flex-1">
							<p class="text-xs font-medium">Agent access</p>
							<p class="text-[11px] text-gray-500 mt-0.5 mb-1.5">
								Read-only lets the agent read your data. Full also lets it change client
								records — use only when you mean to.
							</p>
							<XplanAccessControl bind:level on:change={() => refresh()} />
						</div>
					</li>
				</ol>
			</div>
		{/if}
	</div>
{/if}
