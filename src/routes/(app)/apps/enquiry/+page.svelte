<script lang="ts">
	// Stage 1 · New Client Enquiry — four rows that ACT (spec §5.4).
	// State is per client in data-layer (GET /gw/onboarding/{id}); the rows
	// draft, send and book through jobs on axi's worker and this page only
	// asks and watches. Nothing here holds a job.
	//
	// The client bar switches the active client WITHOUT remounting this page
	// (clientTarget.rescopeUrl returns null here), so the page reloads on a
	// switch and every handler acts on the client it LOADED
	// (state.lead.xplanClientId), never the live store (amendment B2).
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { activeClient, linkableClientId } from '$lib/apps/activeClient';
	import {
		getOnboarding,
		getTemplateChoices,
		runAction,
		setAction,
		setStage,
		type OnboardingAction,
		type OnboardingJobKind,
		type OnboardingState,
		type Step,
		type TemplateOption
	} from '$lib/apis/gateway/onboarding';
	import { EMPTY_SNAPSHOT } from '$lib/apis/gateway/jobs';
	import {
		ENQUIRY_ROWS,
		BOOK_STEP,
		STATUS_CHIP,
		actionMessage,
		autoDraftSteps,
		byStep,
		canBook,
		canContinue,
		canSend,
		doneCount,
		emailOf,
		errorOf,
		isStuckDrafting,
		jobRefusal,
		pickNeedsAgain,
		runningFor,
		sendModeOf,
		sendsAgain,
		slotOf,
		slotsOf,
		type SendMode
	} from '$lib/apps/onboarding';
	import { syncJobs, refreshJobs, startJobPolling } from '$lib/stores/syncJobs';
	import XplanLink from '$lib/components/xplan/XplanLink.svelte';

	let state: OnboardingState | null = null;
	let loading = true;
	let error = '';
	let mounted = false;
	// The client this page was last asked to show — what the reload guard
	// compares the active client against (set before the fetch, so a failed
	// load does not retry in a loop).
	let requestedFor: string | null = null;
	// Bumped on every open(): an await that resumes under a newer generation
	// belongs to a client no longer on screen and must not write anything.
	let openGen = 0;
	// Send modal
	let sendFor: OnboardingAction | null = null;
	let sendMode: SendMode = 'send';
	let subject = '';
	let html = '';
	let sending = false;
	// A slot pick in flight
	let picking = false;
	// Template picker: the row asking, its choices, the one ticked. `choosing`
	// is the row whose list is being fetched.
	let pickFor: Step | null = null;
	let pickOptions: TemplateOption[] = [];
	let pickChosen = '';
	let choosing: Step | null = null;

	const token = () => localStorage.getItem('token') ?? '';

	/** Read `id`'s rows. Dropped if the planner switched client meanwhile. */
	const load = async (id: string, gen: number = openGen) => {
		try {
			const next = await getOnboarding(token(), id);
			if (gen !== openGen) return;
			state = next;
			error = '';
		} catch (e) {
			if (gen !== openGen) return;
			error = actionMessage(e);
		}
		loading = false;
	};

	/** Show `id` from scratch: rows, then draft every pending row that has a template. */
	const open = async (id: string | null) => {
		const gen = ++openGen;
		requestedFor = id;
		state = null;
		sendFor = null;
		sending = false;
		picking = false;
		pickFor = null;
		choosing = null;
		error = '';
		if (!id) {
			loading = false;
			return;
		}
		loading = true;
		// Jobs before rows: a draft already in flight must read "Working…",
		// not "stuck" with a Try again.
		await refreshJobs(token());
		if (gen !== openGen) return;
		await load(id, gen);
		void startJobPolling(token());
		// Sequential: the worker runs one job at a time anyway, and three
		// clicks' worth of 409s is not a better first impression.
		for (const step of autoDraftSteps(state)) {
			if (gen !== openGen) return;
			await run(step, 'onb_draft');
		}
	};

	/** Queue a job. False when the page moved to another client meanwhile. */
	const run = async (
		step: Step,
		kind: OnboardingJobKind,
		args: Record<string, unknown> = {}
	): Promise<boolean> => {
		const gen = openGen;
		const id = state?.lead.xplanClientId;
		if (!id) return false;
		try {
			await runAction(token(), id, step, kind, args);
			if (gen === openGen) error = '';
		} catch (e) {
			if (gen === openGen) error = actionMessage(e);
		}
		if (gen !== openGen) return false;
		// Jobs first: a row reloaded as `drafting` against a snapshot without
		// its job would flash "Try again".
		await refreshJobs(token());
		await load(id, gen);
		void startJobPolling(token());
		return gen === openGen;
	};

	/**
	 * Draft or Regenerate. With more than one template, ask which (the row's
	 * last one ticked); with one, draft from it; with none, the job's
	 * no_template message says where to add one.
	 */
	const startDraft = async (step: Step) => {
		const gen = openGen;
		const id = state?.lead.xplanClientId;
		if (!id) return;
		choosing = step;
		try {
			const choices = await getTemplateChoices(token(), id, step);
			if (gen !== openGen) return;
			choosing = null;
			if (choices.templates.length > 1) {
				pickOptions = choices.templates;
				pickChosen = choices.selected ?? choices.templates[0].id;
				pickFor = step;
				return;
			}
			await run(step, 'onb_draft', choices.selected ? { template_id: choices.selected } : {});
		} catch (e) {
			if (gen !== openGen) return;
			choosing = null;
			error = actionMessage(e);
		}
	};

	const confirmPick = async () => {
		if (!pickFor || !pickChosen) return;
		const step = pickFor;
		const template_id = pickChosen;
		pickFor = null;
		await run(step, 'onb_draft', { template_id });
	};

	const templateOf = (a: OnboardingAction) =>
		((a.detail?.template as { name?: string } | undefined)?.name ?? '') || null;

	onMount(() => {
		mounted = true;
	});

	// Reload whenever the active client is not the one on screen (B2).
	$: if (mounted && $linkableClientId !== requestedFor) void open($linkableClientId);

	$: loadedFor = state?.lead.xplanClientId ?? null;
	// The store starts as EMPTY_SNAPSHOT and is replaced on every poll: until
	// the first poll lands, "no running job" means "not asked yet".
	$: jobsLoaded = $syncJobs !== EMPTY_SNAPSHOT;

	// Re-read the rows whenever one of THIS client's onboarding jobs leaves
	// the running list — that is the moment a chip changes. A job that was
	// refused (busy, already sent…) leaves the row as it was, so its own
	// error is the only sign the click did anything: show it.
	let seen = new Set<string>();
	$: {
		const mine = new Set(
			$syncJobs.running
				.filter((j) => j.kind.startsWith('onb_') && loadedFor && j.params?.client === loadedFor)
				.map((j) => j.id)
		);
		const gone = [...seen].filter((id) => !mine.has(id));
		if (loadedFor && gone.length) {
			const refusal = gone.map((id) => jobRefusal($syncJobs, id)).find((m) => m);
			const gen = openGen;
			void load(loadedFor, gen).then(() => {
				if (refusal && gen === openGen && !rowSays(refusal)) error = refusal;
			});
		}
		seen = mine;
	}

	/** A failed row already shows its own message; don't repeat it on top. */
	const rowSays = (text: string) =>
		(state?.actions ?? []).some((a) => a.status === 'failed' && errorOf(a)?.message === text);

	const stuck = (a: OnboardingAction) =>
		!!loadedFor && jobsLoaded && isStuckDrafting(a, $syncJobs, loadedFor);

	const tick = async (a: OnboardingAction) => {
		const gen = openGen;
		const id = state?.lead.xplanClientId;
		if (!id || a.xplanClientId !== id) return;
		if (a.status === 'drafting' && !stuck(a)) return;
		try {
			await setAction(token(), id, a.step, a.status === 'done' ? 'pending' : 'done');
			if (gen === openGen) error = '';
		} catch (e) {
			if (gen === openGen) error = actionMessage(e);
		}
		if (gen === openGen) await load(id, gen);
	};

	const openSend = (a: OnboardingAction, mode: SendMode) => {
		sendFor = a;
		sendMode = mode;
		subject = emailOf(a)?.subject ?? '';
		html = emailOf(a)?.html ?? '';
	};

	const confirmSend = async () => {
		if (!sendFor) return;
		// The modal belongs to the client it was opened for. If the active
		// client changed under it, sending would mail this body to someone else.
		if (
			sendFor.xplanClientId !== $linkableClientId ||
			sendFor.xplanClientId !== state?.lead.xplanClientId
		) {
			sendFor = null;
			error = 'The active client changed — nothing was sent. Open Send again for this client.';
			return;
		}
		sending = true;
		const current = await run(sendFor.step, 'onb_send', {
			again: sendsAgain(sendMode),
			email: { subject, html }
		});
		// A switch meanwhile already reset the modal for the new client.
		if (!current) return;
		sending = false;
		sendFor = null;
	};

	const pickSlot = async (a: OnboardingAction, slot: { start: string }) => {
		if (a.xplanClientId !== state?.lead.xplanClientId) return;
		picking = true;
		const current = await run(BOOK_STEP, 'onb_book', {
			slot: { start: slot.start },
			...(pickNeedsAgain(a) ? { again: true } : {})
		});
		if (current) picking = false;
	};

	const continueOn = async () => {
		const id = state?.lead.xplanClientId;
		if (!id) return;
		try {
			await setStage(token(), id, 'discovery');
			goto('/apps/discovery');
		} catch (e) {
			error = actionMessage(e);
		}
	};

	const SECOND_INVITE =
		'This sends a second invite — the first one is not cancelled; remove it from your calendar if you are rescheduling.';

	const sendLabel: Record<SendMode, string> = {
		send: 'Send',
		retry: 'Send',
		again: 'Send again',
		unrecorded: 'Send again'
	};

	$: actions = state?.actions ?? [];
	$: map = byStep(actions);
	$: noDrive = state?.drive.connected === false;
	$: completed = doneCount(actions, 'enquiry');
	$: bookable = canBook(actions);
	$: finished = canContinue(actions);
</script>

<div class="max-w-3xl mx-auto px-8 py-10">
	{#if !$linkableClientId || !$activeClient}
		<div class="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 p-8 text-center">
			<p class="text-sm font-medium">No client selected</p>
			<p class="text-sm text-gray-500 mt-1 mb-4">Pick a client on the Clients hub to start an enquiry.</p>
			<button
				on:click={() => goto('/apps/clients')}
				class="inline-flex rounded-xl bg-black text-white dark:bg-white dark:text-black px-4 py-2.5 text-sm font-medium hover:opacity-90 transition"
				>Go to Clients</button
			>
		</div>
	{:else if loading}
		<p class="text-sm text-gray-500">Loading…</p>
	{:else if !state || !loadedFor}
		<p class="text-sm text-red-600 dark:text-red-400">{error || 'Could not load this client’s enquiry.'}</p>
	{:else}
		<div class="mb-6 flex items-start justify-between gap-4">
			<div>
				<p class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Stage 1 · New Client Enquiry</p>
				<h1 class="text-2xl font-semibold tracking-tight mt-1">{$activeClient.name}</h1>
				<p class="text-sm text-gray-500 mt-1">
					Initial contact &amp; triage — {completed}/{ENQUIRY_ROWS.length} done.
				</p>
			</div>
			<XplanLink
				path={`/factfind/view/${loadedFor}?role=client`}
				label="Fact Find"
				size="md"
				title="Open this client's Fact Find in XPLAN"
			/>
		</div>

		{#if error}
			<p class="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>
		{/if}
		{#if noDrive}
			<div
				class="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-200 mb-3"
			>
				Connect a drive to draft documents — in
				<a href="/x/salem/connectors" class="font-medium underline">Meetings › Connections</a>, connect a
				drive, then assign this client a folder.
			</div>
		{/if}

		<div
			class="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden"
		>
			{#each ENQUIRY_ROWS as row}
				{@const a = map.get(row.step)}
				{@const job = runningFor($syncJobs, loadedFor, row.step)}
				{@const chip = a ? STATUS_CHIP[a.status] : STATUS_CHIP.pending}
				{@const err = a ? errorOf(a) : null}
				{@const mode = a && row.kind === 'document' ? sendModeOf(a) : null}
				{@const isStuck = !!a && !job && jobsLoaded && isStuckDrafting(a, $syncJobs, loadedFor)}
				<div class="px-4 py-3.5">
					<div class="flex items-start gap-3">
						<input
							type="checkbox"
							checked={a?.status === 'done'}
							disabled={!a || !!job || (a.status === 'drafting' && !isStuck)}
							on:change={() => a && tick(a)}
							title={a?.status === 'done' ? 'Untick (keeps the evidence)' : 'Mark done by hand'}
							class="mt-0.5 size-4 rounded accent-black dark:accent-white"
						/>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<p class="text-sm font-medium {a?.status === 'done' ? 'line-through text-gray-400' : ''}">
									{row.title}
								</p>
								<span class="text-[10px] px-1.5 py-0.5 rounded-full {chip.class}"
									>{job ? (job.status === 'queued' ? 'Queued…' : 'Working…') : chip.label}</span
								>
								{#if a?.completedBy === 'agent'}<span class="text-[10px] text-gray-400">by axi</span>{/if}
							</div>
							<p class="text-xs text-gray-500 mt-0.5">{row.detail}</p>
							{#if job?.progress}<p class="text-xs text-gray-500 mt-1">{job.progress}</p>{/if}
							{#if err && a?.status === 'failed'}
								<p class="text-xs text-red-600 dark:text-red-400 mt-1">{err.message}</p>
							{/if}
							{#if mode === 'unrecorded'}
								<p class="text-xs text-amber-700 dark:text-amber-300 mt-1">
									This email may already have gone out — check your Sent Items before using Send again.
								</p>
							{/if}
							{#if a?.status === 'failed' && err?.code === 'sent_unrecorded' && row.kind === 'booking'}
								<p class="text-xs text-amber-700 dark:text-amber-300 mt-1">
									The invite may already be in your calendar — check it before booking again.
								</p>
							{/if}
							{#if isStuck}
								<p class="text-xs text-gray-500 mt-1">The draft stopped before it finished.</p>
							{/if}
							{#if a && row.kind === 'document' && a.status !== 'pending' && a.status !== 'drafting' && templateOf(a)}
								<p class="text-xs text-gray-400 mt-1">From template: {templateOf(a)}</p>
							{/if}
							{#if a && row.kind === 'document' && (a.status === 'sent' || a.status === 'done') && emailOf(a)?.to}
								<p class="text-xs text-gray-400 mt-1">Sent to {emailOf(a)?.to}</p>
							{/if}
							{#if a && row.kind === 'booking' && slotOf(a)}
								<p class="text-xs text-gray-400 mt-1">Invite sent for {slotOf(a)?.label}</p>
							{/if}
							{#if a && row.kind === 'booking' && a.status !== 'done' && slotsOf(a).length}
								{#if pickNeedsAgain(a)}
									<p class="text-xs text-amber-700 dark:text-amber-300 mt-2">{SECOND_INVITE}</p>
								{/if}
								<div class="flex flex-wrap gap-2 mt-2">
									{#each slotsOf(a) as s}
										<button
											on:click={() => pickSlot(a, s)}
											disabled={picking || !!job}
											class="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-850 disabled:opacity-50 transition"
										>
											{s.label}
										</button>
									{/each}
								</div>
							{/if}
						</div>
						<div class="shrink-0 flex items-center gap-1.5">
							{#if a && row.kind === 'document'}
								{#if a.draftUrl?.startsWith('https:') && a.status !== 'pending' && a.status !== 'drafting'}
									<a
										href={a.draftUrl}
										target="_blank"
										rel="noopener"
										class="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-850 transition"
										>Preview</a
									>
								{/if}
								{#if mode}
									<button
										on:click={() => openSend(a, mode)}
										disabled={!!job || (mode === 'send' && !canSend(a))}
										title={mode === 'send' && !canSend(a) ? 'No email on file — add it in XPLAN' : ''}
										class="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-black text-white dark:bg-white dark:text-black hover:opacity-90 disabled:opacity-40 transition"
									>
										{sendLabel[mode]}
									</button>
								{/if}
								{#if a.status === 'pending' || (a.status === 'failed' && !a.draftRef) || isStuck}
									<button
										on:click={() => startDraft(a.step)}
										disabled={!!job || noDrive || choosing === a.step}
										title={noDrive ? 'Connect a drive in Meetings › Connections to draft documents' : ''}
										class="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-850 disabled:opacity-40 transition"
									>
										{a.status === 'pending' ? 'Draft' : 'Try again'}
									</button>
								{:else if a.status === 'ready' || a.status === 'sent' || a.status === 'failed'}
									<button
										on:click={() => startDraft(a.step)}
										disabled={!!job || noDrive || choosing === a.step}
										title={noDrive ? 'Connect a drive in Meetings › Connections to draft documents' : ''}
										class="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-850 disabled:opacity-40 transition"
									>
										Regenerate
									</button>
								{/if}
							{:else if a && row.kind === 'booking' && a.status !== 'done'}
								<button
									on:click={() => run(BOOK_STEP, 'onb_book')}
									disabled={!bookable || !!job || picking}
									title={!bookable
										? 'Send the welcome pack, FSG and fact find first'
										: pickNeedsAgain(a)
											? SECOND_INVITE
											: ''}
									class="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-black text-white dark:bg-white dark:text-black hover:opacity-90 disabled:opacity-40 transition"
								>
									{slotsOf(a).length
										? 'Other times'
										: pickNeedsAgain(a)
											? 'Book again'
											: 'Book'}
								</button>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>

		<div class="flex items-center justify-between gap-3 mt-5">
			<span class="text-xs text-gray-400"
				>Lead opened {state.lead.createdAt ? new Date(state.lead.createdAt).toLocaleDateString() : ''}</span
			>
			<button
				on:click={continueOn}
				disabled={!finished}
				class="rounded-xl bg-black text-white dark:bg-white dark:text-black px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-40 transition"
			>
				Continue to Discovery Meeting →
			</button>
		</div>
		{#if !finished}
			<p class="text-xs text-gray-400 mt-3">
				All four rows must be done to move this client to the Discovery Meeting.
			</p>
		{/if}
	{/if}
</div>

{#if sendFor}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
		<div class="w-full max-w-xl rounded-2xl bg-white dark:bg-gray-900 shadow-xl p-5">
			<p class="text-xs font-semibold text-gray-400 uppercase tracking-wide">
				{sendsAgain(sendMode) ? 'Send again from your mailbox' : 'Send from your mailbox'}
			</p>
			<p class="text-sm mt-1">
				To <span class="font-medium">{emailOf(sendFor)?.to ?? '(no email on file)'}</span> · attaching
				<span class="font-medium">{String(sendFor.detail?.draft_name ?? '')}</span>
			</p>
			{#if sendMode === 'unrecorded'}
				<p class="text-xs text-amber-700 dark:text-amber-300 mt-2">
					The last send may have gone out. Check your Sent Items first — this sends another copy.
				</p>
			{/if}
			<label class="block mt-3 text-xs text-gray-500"
				>Subject
				<input
					bind:value={subject}
					maxlength="200"
					class="mt-1 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
				/>
			</label>
			<label class="block mt-3 text-xs text-gray-500"
				>Body (HTML)
				<textarea
					bind:value={html}
					rows="10"
					class="mt-1 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm font-mono"
				></textarea>
			</label>
			<p class="text-xs text-gray-400 mt-1">
				Only paragraphs, line breaks, bold, italic and lists are kept when sent.
			</p>
			<p class="text-xs text-gray-400 mt-2">
				The attachment is the current file in the client's folder — edits made in Preview are included.
			</p>
			<div class="flex justify-end gap-2 mt-4">
				<button
					on:click={() => (sendFor = null)}
					disabled={sending}
					class="text-sm px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-850 transition"
					>Cancel</button
				>
				<button
					on:click={confirmSend}
					disabled={sending || !subject.trim() || !html.trim()}
					class="text-sm px-4 py-2 rounded-xl bg-black text-white dark:bg-white dark:text-black hover:opacity-90 disabled:opacity-40 transition"
					>{sending ? 'Sending…' : sendLabel[sendMode]}</button
				>
			</div>
		</div>
	</div>
{/if}

{#if pickFor}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
		<div class="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 shadow-xl p-5">
			<p class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Choose a template</p>
			<p class="text-sm mt-1">
				{ENQUIRY_ROWS.find((r) => r.step === pickFor)?.title ?? ''} has more than one published template.
			</p>
			<div class="mt-3 flex flex-col gap-1.5 max-h-72 overflow-y-auto">
				{#each pickOptions as t (t.id)}
					<label
						class="flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm cursor-pointer transition {pickChosen === t.id
							? 'border-black dark:border-white'
							: 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-850'}"
					>
						<input type="radio" bind:group={pickChosen} value={t.id} class="accent-black dark:accent-white" />
						<span class="min-w-0 flex-1 truncate">{t.name}</span>
						<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500"
							>{t.scope === 'client' ? 'This client' : 'Firm'}</span
						>
					</label>
				{/each}
			</div>
			<div class="flex justify-end gap-2 mt-4">
				<button
					on:click={() => (pickFor = null)}
					class="text-sm px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-850 transition"
					>Cancel</button
				>
				<button
					on:click={confirmPick}
					disabled={!pickChosen}
					class="text-sm px-4 py-2 rounded-xl bg-black text-white dark:bg-white dark:text-black hover:opacity-90 disabled:opacity-40 transition"
					>Draft</button
				>
			</div>
		</div>
	</div>
{/if}
