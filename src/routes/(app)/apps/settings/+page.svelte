<script lang="ts">
	// XPLAN access — the one page that answers "can the agent reach XPLAN, and
	// what is it allowed to do there?"
	//
	// This used to be a single on/off switch over GET/PUT /gw/guardrail, while the
	// same state was also editable from the status pill's popover in the top bar.
	// Two writers, and the switch was the weaker one: the guardrail bit is only
	// the `lock` tier, so the switch could not tell Read-only from Full, and
	// turning it on always reset the mode to read-only without saying so.
	//
	// So the popover's checklist moved here and the pill became a link to this
	// page. One copy of the markup, and the tier control below is the only thing
	// that writes the access state.
	import { onMount, onDestroy } from 'svelte';
	import {
		getXplanStatus,
		getXplanAccess,
		relaunchDebugBrowser,
		openInXplan,
		accessMeta,
		type XplanAccessLevel
	} from '$lib/apis/gateway';
	import XplanAccessControl from '$lib/components/xplan/XplanAccessControl.svelte';

	const token = () => localStorage.getItem('token') ?? '';

	let level: XplanAccessLevel = 'readonly';
	let browserUp = false;
	let loggedIn: boolean | null = null;
	let probed = false;
	// The gateway itself is unreachable (network/CORS/auth), as opposed to
	// reachable-but-reporting-a-problem. Tracked separately so the page can say
	// which of the two it is.
	let unreachable = false;
	let loaded = false;

	let reopening = false;
	let reopenErr = '';
	let signingIn = false;
	let signInErr = '';

	$: step1 = !probed ? 'unknown' : browserUp ? 'ok' : 'todo';
	$: step2 = loggedIn === true ? 'ok' : loggedIn === false ? 'fail' : 'unknown';

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

	/**
	 * Poll faster than the 30s heartbeat for a little while.
	 *
	 * Both buttons below act on a browser this page cannot see, so the only way a
	 * step ticks over to a green check is the next probe. Waiting up to 30s for it
	 * reads as "the button did nothing".
	 */
	const pollUntil = async (done: () => boolean, tries = 15, gap = 2000) => {
		for (let i = 0; i < tries && !done(); i++) {
			await new Promise((r) => setTimeout(r, gap));
			await refresh();
		}
	};

	const reopen = async () => {
		if (reopening) return;
		reopening = true;
		reopenErr = '';
		try {
			await relaunchDebugBrowser(token());
			await pollUntil(() => browserUp, 8, 1500);
		} catch (e: any) {
			reopenErr = typeof e === 'string' ? e : (e?.message ?? 'Could not reopen the browser');
		} finally {
			reopening = false;
		}
	};

	/**
	 * Open XPLAN in the debug Chrome so the planner can sign in there.
	 *
	 * This used to always open '/dashboard/', on the assumption that XPLAN would
	 * redirect it to the sign-in page when there was no session. It does not --
	 * unauthenticated '/dashboard/' returns a bare 404 (verified 2026-08-30), so
	 * the button dropped the planner on an error page instead of a login form.
	 * Worse, the status probe reads login state from the URL, and a 404
	 * '/dashboard/' carries no login marker, so it reported "signed in".
	 *
	 * So: send them to the login page unless we already believe they are in.
	 *
	 * The tab opens in the OTHER browser window and nothing here can raise it —
	 * the caretaker serves /health, /heartbeat and /relaunch, and has no focus
	 * route. Hence the "switch to that window" line under the button.
	 */
	const signIn = async () => {
		if (signingIn) return;
		signingIn = true;
		signInErr = '';
		try {
			await openInXplan(token(), loggedIn === true ? '/dashboard/' : '/login2');
			await pollUntil(() => loggedIn === true);
		} catch (e: any) {
			signInErr = typeof e === 'string' ? e : (e?.message ?? 'Could not open XPLAN');
		} finally {
			signingIn = false;
		}
	};

	const onFocus = () => {
		// Coming back from the debug Chrome is the moment the answer most often
		// changed, so re-probe on focus rather than waiting for the timer.
		if (document.visibilityState === 'visible') refresh();
	};

	let timer: ReturnType<typeof setInterval> | null = null;
	onMount(async () => {
		// Auth token can 401 transiently while OWUI starts up — retry through it.
		let ok = false;
		for (let i = 0; i < 6 && !(ok = await refresh()); i++) {
			await new Promise((r) => setTimeout(r, 1000));
		}
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
</script>

<!-- max-w-3xl, matching the /apps context bar above it, so the XPLAN pill in that
     bar sits on this page's left margin rather than a little inside it. -->
<div class="max-w-3xl mx-auto px-8 py-10">
	<h1 class="text-2xl font-semibold tracking-tight mb-1">XPLAN access</h1>
	<p class="text-sm text-gray-500 mb-8">
		Connect the browser, sign in, and choose what the agent is allowed to do.
		Checking the connection is free — only refreshing uses the AI.
	</p>

	{#if unreachable}
		<div
			class="mb-6 text-sm rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 p-4"
		>
			<p class="text-red-700 dark:text-red-400">
				axi's gateway didn't answer, so the steps below can't be checked. This is axi itself,
				not XPLAN — nothing about your XPLAN session has changed.
			</p>
			<button
				type="button"
				on:click={refresh}
				class="mt-2 text-xs font-medium underline underline-offset-2 text-red-700 dark:text-red-400"
			>
				Try again
			</button>
		</div>
	{/if}

	<div
		class="rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-850 p-6"
	>
		<ol class="space-y-6">
			<!-- 1 · debug browser -->
			<li class="flex gap-3.5">
				<span
					class="mt-0.5 shrink-0 size-5 rounded-full flex items-center justify-center text-[10px] font-semibold
						{step1 === 'ok'
						? 'bg-green-500 text-white'
						: step1 === 'todo'
							? 'bg-amber-500 text-white'
							: 'bg-gray-200 dark:bg-gray-700 text-gray-500'}"
				>
					{step1 === 'ok' ? '✓' : '1'}
				</span>
				<div class="min-w-0 flex-1">
					<h2 class="text-sm font-semibold">Debug browser</h2>
					<p class="text-sm text-gray-500 mt-1">
						{#if step1 === 'ok'}
							Running. Your XPLAN session lives in this window, not in axi.
						{:else if step1 === 'todo'}
							Not running. It normally reopens on its own — if it hasn't, reopen it here.
						{:else}
							Checking…
						{/if}
					</p>
					{#if step1 !== 'ok'}
						<button
							type="button"
							on:click={reopen}
							disabled={reopening}
							class="mt-2.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border
								border-gray-200 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-900
								disabled:opacity-50 disabled:cursor-wait transition"
						>
							{reopening ? 'Reopening…' : 'Reopen debug browser'}
						</button>
						{#if reopenErr}
							<p class="text-xs text-red-600 dark:text-red-400 mt-2">{reopenErr}</p>
						{/if}
					{/if}
				</div>
			</li>

			<!-- 2 · sign in -->
			<li class="flex gap-3.5">
				<span
					class="mt-0.5 shrink-0 size-5 rounded-full flex items-center justify-center text-[10px] font-semibold
						{step2 === 'ok'
						? 'bg-green-500 text-white'
						: step2 === 'fail'
							? 'bg-amber-500 text-white'
							: 'bg-gray-200 dark:bg-gray-700 text-gray-500'}"
				>
					{step2 === 'ok' ? '✓' : '2'}
				</span>
				<div class="min-w-0 flex-1">
					<h2 class="text-sm font-semibold">Sign in to XPLAN</h2>
					<p class="text-sm text-gray-500 mt-1">
						{#if step2 === 'ok'}
							Signed in. axi never sees your password — the session stays in that browser.
						{:else if step2 === 'fail'}
							The browser is up but not on a signed-in XPLAN page.
						{:else}
							Open XPLAN in the debug browser and sign in — your session stays there.
						{/if}
					</p>
					{#if step2 !== 'ok'}
						<button
							type="button"
							on:click={signIn}
							disabled={signingIn || !browserUp}
							class="mt-2.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-black text-white
								dark:bg-white dark:text-black hover:opacity-90
								disabled:opacity-50 disabled:cursor-not-allowed transition"
						>
							{signingIn ? 'Waiting for sign-in…' : 'Open XPLAN and sign in'}
						</button>
						<p class="text-xs text-gray-400 mt-1.5">
							{#if !browserUp}
								Finish step 1 first — there's no browser to open it in.
							{:else}
								Opens a tab in the debug Chrome window. Switch to that window to sign in;
								this page ticks over on its own once you're through.
							{/if}
						</p>
						{#if signInErr}
							<p class="text-xs text-red-600 dark:text-red-400 mt-2">{signInErr}</p>
						{/if}
					{/if}
				</div>
			</li>

			<!-- 3 · access tier -->
			<li class="flex gap-3.5">
				<span
					class="mt-0.5 shrink-0 size-5 rounded-full flex items-center justify-center text-[10px] font-semibold
						{level !== 'lock'
						? 'bg-green-500 text-white'
						: 'bg-gray-200 dark:bg-gray-700 text-gray-500'}"
				>
					{level !== 'lock' ? '✓' : '3'}
				</span>
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2">
						<h2 class="text-sm font-semibold">Agent access</h2>
						{#if loaded}
							<span
								class="text-[11px] font-mono px-2 py-0.5 rounded-full {level === 'lock'
									? 'text-gray-600 bg-gray-200 dark:text-gray-300 dark:bg-gray-700'
									: level === 'full'
										? 'text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-900/40'
										: 'text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-900/40'}"
							>
								{accessMeta(level).icon}
								{accessMeta(level).label}
							</span>
						{/if}
					</div>
					<p class="text-sm text-gray-500 mt-1 mb-3">
						<span class="font-medium">Lock</span> turns the agent's browser tools off entirely —
						it cannot open, read or write XPLAN.
						<span class="font-medium">Read-only</span> lets it read your data.
						<span class="font-medium">Full</span> also lets it change client records — turn that
						on only while you're working in XPLAN and watching, then turn it back down.
					</p>
					<XplanAccessControl bind:level on:change={() => refresh()} />
				</div>
			</li>
		</ol>

		<p class="text-xs text-gray-400 mt-6 pt-4 border-t border-gray-100 dark:border-gray-800">
			The access level is enforced by axi and persisted, so it stays put across restarts.
			Stepping down from Full always returns to Read-only, never straight back to Full.
		</p>
	</div>
</div>
