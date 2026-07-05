<script lang="ts">
	// Settings — currently: the XPLAN access guardrail toggle.
	// "Access on" = hermes may drive XPLAN; "off" = the browser toolset is
	// disabled (hermes cannot open/read/write XPLAN). Enforced in hermes, so it
	// survives restarts. Toggled through the contact-layer gateway.
	import { onMount } from 'svelte';
	import { getGuardrail, setGuardrail } from '$lib/apis/gateway';

	let loading = true;
	let saving = false;
	let error = '';
	let locked = true; // safe default until we load real state

	$: accessOn = !locked;

	const load = async () => {
		loading = true;
		error = '';
		try {
			locked = await getGuardrail(localStorage.getItem('token') ?? '');
		} catch (e: any) {
			error = e?.message ?? 'Could not read the guardrail state';
		} finally {
			loading = false;
		}
	};

	const toggle = async () => {
		if (saving) return;
		saving = true;
		error = '';
		const next = !locked; // flip
		try {
			locked = await setGuardrail(localStorage.getItem('token') ?? '', next);
		} catch (e: any) {
			error = e?.message ?? 'Could not change the guardrail';
		} finally {
			saving = false;
		}
	};

	onMount(load);
</script>

<div class="max-w-2xl mx-auto px-8 py-10">
	<h1 class="text-2xl font-semibold tracking-tight mb-1">Settings</h1>
	<p class="text-sm text-gray-500 mb-8">Controls for the xplan-agent workspace.</p>

	<div class="rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-850 p-6">
		<div class="flex items-start justify-between gap-6">
			<div class="min-w-0">
				<div class="flex items-center gap-2">
					<h2 class="text-base font-semibold">XPLAN access</h2>
					{#if !loading}
						<span
							class="text-[11px] font-mono px-2 py-0.5 rounded-full {locked
								? 'text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-900/40'
								: 'text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-900/40'}"
						>
							{locked ? '🔒 locked' : '🔓 unlocked'}
						</span>
					{/if}
				</div>
				<p class="text-sm text-gray-500 mt-1.5">
					When <span class="font-medium">off</span>, the AI agent <span class="font-medium"
						>cannot open, read, or write XPLAN</span
					> — it has no browser tools at all. Turn it on only while you're actively working
					in XPLAN and watching, then turn it back off.
				</p>
				{#if error}
					<p class="text-sm text-red-600 dark:text-red-400 mt-2">{error}
						<button on:click={load} class="underline underline-offset-2 ml-1">retry</button>
					</p>
				{/if}
			</div>

			<!-- toggle switch: ON (right, amber) = access allowed / unlocked -->
			<button
				role="switch"
				aria-checked={accessOn}
				aria-label="XPLAN access"
				disabled={loading || saving}
				on:click={toggle}
				class="relative shrink-0 mt-1 w-12 h-7 rounded-full transition disabled:opacity-50
					{accessOn ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-700'}"
			>
				<span
					class="absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform
						{accessOn ? 'translate-x-5' : 'translate-x-0'}"
				></span>
			</button>
		</div>

		<p class="text-xs text-gray-400 mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
			Enforced in hermes and persisted, so it stays put across restarts. Replaces the
			<code>scripts/xplan-guardrail.sh</code> command-line switch.
		</p>
	</div>
</div>
