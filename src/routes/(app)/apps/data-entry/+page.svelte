<script lang="ts">
	import { DOCUMENTS_APP_NAME } from '$lib/apps/brand';
	// Stage 3 · Data Entry & Research — four action rows (spec §5.4).
	//
	// `update_xplan` holds the Phase A wizard: Upload → Review → Write (stub).
	// Uploads go to finny as the client's documents (not OWUI's file volume),
	// and the planner can pick from the documents the client already has
	// there. The wizard session is keyed by CLIENT (`onboarding:{client}`) so a
	// reload resumes the proposal. The other three rows are manual ticks on
	// the per-client onboarding state. Nothing is written to XPLAN here — the
	// agent only PROPOSES.
	//
	// The client bar switches the active client WITHOUT remounting this page,
	// so the page reloads on a switch and every write — ticks, uploads into
	// finny, the saved session — goes to the client it LOADED (`loadedFor`),
	// never the live store (Plan 3 amendment B2). An await that resumes under
	// a newer `openGen` belongs to a client no longer on screen: its result is
	// dropped, never applied.
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		extractExisting,
		proposeMapping,
		type ExtractedDoc,
		type OnboardingProposal,
		type ProposalItem
	} from '$lib/apis/onboarding';
	import { GatewayError, getOnboardingSession, saveOnboardingSession } from '$lib/apis/gateway';
	import { getOnboarding, setAction, type OnboardingAction, type Step } from '$lib/apis/gateway/onboarding';
	import { listClientDocuments, uploadClientDocument, type FinnyDocument } from '$lib/apis/finny';
	import { activeClient, linkableClientId } from '$lib/apps/activeClient';
	import { actionMessage, byStep, doneCount } from '$lib/apps/onboarding';
	import { rowsFor } from '$lib/apps/onboardingRows';
	import {
		ACCEPTED_TYPES,
		discardedSession,
		fileKey,
		mergeDocs,
		resumeFrom,
		sessionIdFor,
		type WizardStage
	} from '$lib/apps/dataEntry';
	import XplanLink from '$lib/components/xplan/XplanLink.svelte';

	const token = () => localStorage.getItem('token') ?? '';
	const rows = rowsFor('data_entry');
	const UPDATE_XPLAN = 'data_entry.update_xplan';

	let mounted = false;
	// The client this page was last asked to show, and the one on screen.
	let requestedFor: string | null = null;
	let loadedFor: string | null = null;
	let loadedName = '';
	// Bumped on every open(): see the header comment.
	let openGen = 0;

	let loading = true;
	let actions: OnboardingAction[] = [];
	let expanded: string | null = UPDATE_XPLAN;
	let error = '';
	let ticking = false;

	// --- wizard state (inside the update_xplan row) ---
	let stage: WizardStage = 'upload';
	let files: File[] = [];
	// Files already in finny from an earlier attempt, by fileKey (A14): a
	// retry after the proposal step failed reads these instead of uploading
	// the same file into the client's store a second time.
	let uploaded: Record<string, FinnyDocument> = {};
	let dragging = false;
	let busy = false;
	let busyMsg = '';
	let proposal: OnboardingProposal | null = null;

	// --- picker ---
	let pickerOpen = false;
	let pickerLoading = false;
	let pickerDocs: FinnyDocument[] = [];
	let picked: Record<string, boolean> = {};

	$: map = byStep(actions);
	$: completed = doneCount(actions, 'data_entry');
	$: uploadedList = Object.entries(uploaded);
	$: pickedDocs = pickerDocs.filter((d) => picked[d.id]);

	const open = async (id: string | null) => {
		const gen = ++openGen;
		requestedFor = id;
		loadedFor = id;
		loadedName = $activeClient?.name ?? '';
		actions = [];
		error = '';
		ticking = false;
		stage = 'upload';
		files = [];
		uploaded = {};
		busy = false;
		busyMsg = '';
		proposal = null;
		pickerOpen = false;
		pickerLoading = false;
		pickerDocs = [];
		picked = {};
		if (!id) {
			loading = false;
			return;
		}
		loading = true;
		try {
			const state = await getOnboarding(token(), id);
			if (gen !== openGen) return;
			actions = state.actions;
		} catch (e) {
			if (gen !== openGen) return;
			error = actionMessage(e);
		}
		try {
			const saved = await getOnboardingSession(token(), sessionIdFor(id));
			if (gen !== openGen) return;
			const r = resumeFrom(saved);
			stage = r.stage;
			proposal = r.proposal;
		} catch (e) {
			if (gen !== openGen) return;
			console.warn('Could not resume the onboarding session:', e);
		}
		loading = false;
	};

	onMount(() => {
		mounted = true;
	});
	onDestroy(() => {
		openGen++;
	});

	// Reload whenever the active client is not the one on screen (B2).
	$: if (mounted && $linkableClientId !== requestedFor) void open($linkableClientId);

	const toggle = async (ev: Event, step: Step) => {
		const box = ev.currentTarget as HTMLInputElement;
		const gen = openGen;
		const id = loadedFor;
		const wasDone = map.get(step)?.status === 'done';
		if (!id || ticking) {
			box.checked = wasDone;
			return;
		}
		ticking = true;
		const next = wasDone ? 'pending' : 'done';
		try {
			const saved = await setAction(token(), id, step, next);
			if (gen !== openGen) return;
			actions = actions.some((x) => x.step === step)
				? actions.map((x) => (x.step === step ? saved : x))
				: [...actions, saved];
		} catch (e) {
			if (gen !== openGen) return;
			box.checked = wasDone;
			// 404 = no data_entry rows yet: the lead has not reached this stage.
			error =
				e instanceof GatewayError && e.status === 404
					? 'Move the client to Data Entry from the Discovery page first.'
					: actionMessage(e);
		} finally {
			if (gen === openGen) ticking = false;
		}
	};

	// --- files ---
	const onDrop = (e: DragEvent) => {
		e.preventDefault();
		dragging = false;
		if (e.dataTransfer?.files) addFiles(Array.from(e.dataTransfer.files));
	};
	const onPick = (e: Event) => {
		const input = e.target as HTMLInputElement;
		if (input.files) addFiles(Array.from(input.files));
		input.value = '';
	};
	const addFiles = (list: File[]) => {
		// Neither a file already listed nor one already uploaded to finny.
		const existing = new Set([...files.map(fileKey), ...Object.keys(uploaded)]);
		files = [...files, ...list.filter((f) => !existing.has(fileKey(f)))];
	};
	const removeFile = (i: number) => {
		files = files.filter((_, idx) => idx !== i);
	};
	/** Leave an uploaded file out of this proposal. It stays in finny. */
	const forgetUploaded = (key: string) => {
		const { [key]: _gone, ...rest } = uploaded;
		uploaded = rest;
	};

	// --- picker ---
	const openPicker = async () => {
		const gen = openGen;
		const id = loadedFor;
		if (!id) return;
		pickerOpen = true;
		pickerLoading = true;
		try {
			const docs = await listClientDocuments(token(), id);
			if (gen !== openGen) return;
			pickerDocs = docs.filter((d) => d.status === 'ACTIVE');
		} catch (e) {
			if (gen !== openGen) return;
			error = actionMessage(e);
			pickerOpen = false;
		} finally {
			if (gen === openGen) pickerLoading = false;
		}
	};

	/** Save `p` as `id`'s session. Both captured by the caller, so a switch
	 *  mid-save still writes the proposal to the client it belongs to. */
	const persist = async (id: string, p: OnboardingProposal, stageVal: 'proposed' | 'reviewed') => {
		try {
			await saveOnboardingSession(token(), sessionIdFor(id), {
				sessionId: sessionIdFor(id),
				stage: stageVal,
				proposal: p,
				updatedAt: new Date().toISOString()
			});
		} catch (e) {
			console.warn('Could not persist onboarding session:', e);
		}
	};

	const runProposal = async () => {
		const gen = openGen;
		const id = loadedFor;
		const name = loadedName;
		if (!id || busy) return;
		if (!files.length && !uploadedList.length && !pickedDocs.length) {
			error = 'Add at least one document, or choose one the client already has.';
			return;
		}
		busy = true;
		error = '';
		const failures: string[] = [];
		const todo = [...files];
		const chosen = [...pickedDocs];
		try {
			// Review Focus 5: one refused file must not lose the others — each
			// is uploaded and read on its own, and finny's own reason for a
			// refusal is shown as finny gave it, after the file's name.
			for (const f of todo) {
				busyMsg = `Uploading ${f.name} to ${DOCUMENTS_APP_NAME}…`;
				try {
					const doc = await uploadClientDocument(token(), id, f);
					if (gen !== openGen) return;
					uploaded = { ...uploaded, [fileKey(f)]: doc };
					files = files.filter((x) => x !== f);
				} catch (e) {
					if (gen !== openGen) return;
					failures.push(`${f.name}: ${actionMessage(e)}`);
				}
			}
			let docs: ExtractedDoc[] = [];
			for (const d of [...Object.values(uploaded), ...chosen]) {
				busyMsg = `Reading ${d.currentVersion?.fileName ?? d.title}…`;
				try {
					const text = await extractExisting(token(), d);
					if (gen !== openGen) return;
					docs = mergeDocs(docs, [text]);
				} catch (e) {
					if (gen !== openGen) return;
					failures.push(actionMessage(e));
				}
			}
			if (!docs.length) {
				error = failures.join(' · ') || 'Nothing could be extracted.';
				return;
			}
			busyMsg = 'Asking the agent to map the data to XPLAN…';
			const next = await proposeMapping(token(), name.trim(), 'existing', docs);
			if (gen !== openGen) return;
			if (!next.items.length) {
				error = 'The agent found no mappable fields in these documents.';
			} else {
				proposal = next;
				stage = 'review';
				files = [];
				uploaded = {};
				picked = {};
				await persist(id, next, 'proposed');
				if (gen !== openGen) return;
			}
			if (failures.length) error = `Skipped: ${failures.join(' · ')}`;
		} catch (e) {
			if (gen !== openGen) return;
			error = [actionMessage(e), ...failures].join(' · ');
		} finally {
			if (gen === openGen) {
				busy = false;
				busyMsg = '';
			}
		}
	};

	// --- review actions (unchanged from Phase A) ---
	const setStatus = (item: ProposalItem, status: ProposalItem['status']) => {
		item.status = status;
		proposal = proposal;
	};
	const editValue = (item: ProposalItem, v: string) => {
		item.value = v;
		if (item.status === 'proposed') item.status = 'edited';
		proposal = proposal;
	};
	// True for sensitive fields (TFN / ID numbers) that must never be bulk-approved.
	const isSensitive = (it: ProposalItem) => {
		const hay = `${it.field ?? ''} ${it.xplanField ?? ''}`.toLowerCase();
		return hay.includes('tfn') || hay.includes('id');
	};
	// "Approve all" only approves confident, non-sensitive items; the rest
	// stay 'proposed' for the planner to approve one by one.
	const approveAll = () => {
		if (!proposal) return;
		proposal.items.forEach((it) => {
			if (it.status === 'rejected') return;
			if ((it.confidence ?? 1) >= 0.5 && !isSensitive(it)) it.status = 'approved';
		});
		proposal = proposal;
	};
	$: grouped = proposal
		? proposal.items.reduce<Record<string, ProposalItem[]>>((acc, it) => {
				(acc[it.section] ??= []).push(it);
				return acc;
			}, {})
		: {};
	$: approvedCount = proposal ? proposal.items.filter((i) => i.status === 'approved' || i.status === 'edited').length : 0;
	$: rejectedCount = proposal ? proposal.items.filter((i) => i.status === 'rejected').length : 0;

	const toWrite = async () => {
		const gen = openGen;
		const id = loadedFor;
		if (!id || !proposal) return;
		await persist(id, proposal, 'reviewed');
		if (gen === openGen) stage = 'write';
	};
	/** Discard the proposal — on screen AND in the saved session (A21), so a
	 *  reload does not bring it back. */
	const startOver = () => {
		const id = loadedFor;
		const discarded = proposal;
		proposal = null;
		stage = 'upload';
		if (!id || !discarded) return;
		saveOnboardingSession(token(), sessionIdFor(id), discardedSession(id, discarded)).catch((e) =>
			console.warn('Could not clear the onboarding session:', e)
		);
	};

	const confidenceClass = (c?: number) =>
		c == null ? 'text-gray-400' : c >= 0.75 ? 'text-green-600 dark:text-green-400' : c >= 0.5 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400';
</script>

<div class="max-w-3xl mx-auto px-8 py-10">
	{#if !$linkableClientId || !$activeClient}
		<div class="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 p-8 text-center">
			<p class="text-sm font-medium">No client selected</p>
			<p class="text-sm text-gray-500 mt-1 mb-4">Choose who you’re working on first — Data Entry works on the active client.</p>
			<button on:click={() => goto('/apps/clients')} class="inline-flex rounded-xl bg-black text-white dark:bg-white dark:text-black px-4 py-2.5 text-sm font-medium hover:opacity-90 transition">
				Choose a client
			</button>
		</div>
	{:else if loading || !loadedFor}
		<p class="text-sm text-gray-500">Loading…</p>
	{:else}
		<div class="mb-6 flex items-start justify-between gap-4">
			<div>
				<p class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Stage 3 · Data Entry &amp; Research</p>
				<h1 class="text-2xl font-semibold tracking-tight mt-1">{loadedName}</h1>
				<p class="text-sm text-gray-500 mt-1">{completed}/{rows.length} done.</p>
			</div>
			<XplanLink path={`/factfind/view/${loadedFor}?role=client`} label="Fact Find" size="md" title="Open this client's Fact Find in XPLAN" />
		</div>

		{#if error}
			<div class="mb-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-3">{error}</div>
		{/if}

		<div class="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
			{#each rows as r}
				{@const a = map.get(r.step)}
				<div class="px-4 py-3.5">
					<div class="flex items-start gap-3">
						<input type="checkbox" checked={a?.status === 'done'} disabled={ticking} on:change={(e) => toggle(e, r.step)} class="mt-0.5 size-4 rounded accent-black dark:accent-white" />
						<button type="button" class="min-w-0 flex-1 text-left" on:click={() => (expanded = expanded === r.step ? null : r.step)}>
							<p class="text-sm font-medium {a?.status === 'done' ? 'line-through text-gray-400' : ''}">{r.title}</p>
							<p class="text-xs text-gray-500 mt-0.5">{r.detail}</p>
						</button>
						{#if r.step === UPDATE_XPLAN}
							<span class="text-xs text-gray-400">{expanded === r.step ? '▾' : '▸'}</span>
						{/if}
					</div>

					{#if r.step === UPDATE_XPLAN && expanded === r.step}
						<div class="mt-4 ml-7">
							<!-- step indicator -->
							<div class="flex items-center gap-2 mb-4 text-xs font-medium">
								{#each [['upload', 'Upload'], ['review', 'Review'], ['write', 'Write']] as [key, label], i}
									{@const active = stage === key}
									{@const done = ['upload', 'review', 'write'].indexOf(stage) > i}
									<div class="flex items-center gap-2">
										<span class="size-6 rounded-full flex items-center justify-center text-[11px] {active ? 'bg-black text-white dark:bg-white dark:text-black' : done ? 'bg-gray-300 dark:bg-gray-700 text-white dark:text-black' : 'bg-gray-100 dark:bg-gray-800 text-gray-400'}">{i + 1}</span>
										<span class={active ? 'text-black dark:text-white' : 'text-gray-400'}>{label}</span>
									</div>
									{#if i < 2}<span class="text-gray-300 dark:text-gray-700">→</span>{/if}
								{/each}
							</div>

							{#if stage === 'upload'}
								<div class="space-y-4">
									<div
										role="button"
										tabindex="0"
										on:dragover|preventDefault={() => (dragging = true)}
										on:dragleave={() => (dragging = false)}
										on:drop={onDrop}
										class="rounded-2xl border-2 border-dashed p-8 text-center transition {dragging ? 'border-black dark:border-white bg-gray-50 dark:bg-gray-850' : 'border-gray-200 dark:border-gray-700'}"
									>
										<p class="text-sm text-gray-500">
											Drag fact-find, statements or ID documents here, or
											<label class="text-black dark:text-white font-medium underline cursor-pointer">
												browse
												<input type="file" multiple accept={ACCEPTED_TYPES.join(',')} class="hidden" on:change={onPick} />
											</label>
										</p>
										<p class="text-xs text-gray-400 mt-2">PDF, DOC/DOCX, XLSX, PNG, JPG — up to 25 MB each. They are stored with this client's documents in {DOCUMENTS_APP_NAME}.</p>
									</div>

									<div class="flex items-center justify-between">
										<button type="button" on:click={openPicker} class="text-sm font-medium underline">Choose from this client's documents</button>
										{#if pickedDocs.length}<span class="text-xs text-gray-500">{pickedDocs.length} chosen</span>{/if}
									</div>

									{#if pickerOpen}
										<div class="rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
											<div class="px-4 py-2.5 bg-gray-50 dark:bg-gray-850 text-xs font-semibold uppercase tracking-wide text-gray-500 flex justify-between">
												<span>Client documents</span>
												<button type="button" on:click={() => (pickerOpen = false)} class="normal-case font-normal">Close</button>
											</div>
											{#if pickerLoading}
												<p class="px-4 py-3 text-sm text-gray-500">Loading…</p>
											{:else if !pickerDocs.length}
												<p class="px-4 py-3 text-sm text-gray-500">This client has no documents yet.</p>
											{:else}
												<ul class="divide-y divide-gray-100 dark:divide-gray-800">
													{#each pickerDocs as d (d.id)}
														<li>
															<label class="flex items-center gap-3 px-4 py-2.5 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-850">
																<input type="checkbox" bind:checked={picked[d.id]} class="size-4 rounded accent-black dark:accent-white" />
																<span class="truncate">{d.title}</span>
																<span class="text-gray-400 text-xs truncate">{d.currentVersion?.fileName ?? ''} · {new Date(d.updatedAt).toLocaleDateString()}</span>
															</label>
														</li>
													{/each}
												</ul>
											{/if}
										</div>
									{/if}

									{#if files.length || uploadedList.length}
										<ul class="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
											{#each uploadedList as [key, d] (key)}
												<li class="flex items-center justify-between px-4 py-3 text-sm">
													<span class="truncate">{d.currentVersion?.fileName ?? d.title} <span class="text-gray-400">· in {DOCUMENTS_APP_NAME}</span></span>
													<button on:click={() => forgetUploaded(key)} disabled={busy} class="text-gray-400 hover:text-red-500 text-xs">Leave out</button>
												</li>
											{/each}
											{#each files as f, i}
												<li class="flex items-center justify-between px-4 py-3 text-sm">
													<span class="truncate">{f.name} <span class="text-gray-400">· {(f.size / 1024).toFixed(0)} KB</span></span>
													<button on:click={() => removeFile(i)} disabled={busy} class="text-gray-400 hover:text-red-500 text-xs">Remove</button>
												</li>
											{/each}
										</ul>
									{/if}

									<div class="flex items-center justify-end gap-3 pt-1">
										<button
											on:click={runProposal}
											disabled={busy || (!files.length && !uploadedList.length && !pickedDocs.length)}
											class="inline-flex items-center gap-2 rounded-xl bg-black text-white dark:bg-white dark:text-black px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-wait transition"
										>
											{#if busy}
												<svg class="size-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
												{busyMsg || 'Working…'}
											{:else}
												Extract &amp; propose
											{/if}
										</button>
									</div>
								</div>

							{:else if stage === 'review' && proposal}
								<div class="space-y-5">
									<div class="flex items-center justify-between gap-3">
										<div class="text-sm text-gray-500">
											<span class="font-medium text-black dark:text-white">{proposal.items.length}</span> proposed ·
											<span class="text-green-600 dark:text-green-400">{approvedCount} approved</span> ·
											<span class="text-red-500">{rejectedCount} rejected</span>
											<span class="block text-xs text-gray-400 mt-0.5">from {proposal.sourceDocs.join(', ')}</span>
										</div>
										<button on:click={approveAll} class="text-sm font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-850">Approve all</button>
									</div>
									{#if proposal.notes}
										<p class="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-4 py-3">⚠️ {proposal.notes}</p>
									{/if}
									{#each Object.entries(grouped) as [section, items]}
										<div class="rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
											<div class="px-4 py-2.5 bg-gray-50 dark:bg-gray-850 text-xs font-semibold uppercase tracking-wide text-gray-500">{section}</div>
											<div class="divide-y divide-gray-100 dark:divide-gray-800">
												{#each items as item}
													<div class="px-4 py-3 flex items-center gap-3 text-sm {item.status === 'rejected' ? 'opacity-40' : ''}">
														<div class="w-40 shrink-0">
															<div class="font-medium">{item.field}</div>
															<div class="text-xs text-gray-400">{item.xplanResource}{item.xplanField ? `.${item.xplanField}` : ''}</div>
														</div>
														<input value={item.value} on:input={(e) => editValue(item, e.currentTarget.value)} class="flex-1 min-w-0 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10" />
														<span class="w-10 text-right text-xs {confidenceClass(item.confidence)}" title="agent confidence">{item.confidence != null ? Math.round(item.confidence * 100) + '%' : '—'}</span>
														<div class="flex gap-1 shrink-0">
															<button on:click={() => setStatus(item, item.status === 'rejected' ? 'proposed' : 'approved')} title="Approve" class="size-7 rounded-lg flex items-center justify-center transition {item.status === 'approved' || item.status === 'edited' ? 'bg-green-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 hover:text-green-600'}">✓</button>
															<button on:click={() => setStatus(item, 'rejected')} title="Reject" class="size-7 rounded-lg flex items-center justify-center transition {item.status === 'rejected' ? 'bg-red-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 hover:text-red-600'}">✕</button>
														</div>
													</div>
												{/each}
											</div>
										</div>
									{/each}
									<div class="flex items-center justify-between gap-3 pt-1">
										<button on:click={startOver} class="text-sm text-gray-500 hover:text-black dark:hover:text-white">← Start over</button>
										<button on:click={toWrite} disabled={approvedCount === 0} class="rounded-xl bg-black text-white dark:bg-white dark:text-black px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition">Continue to write ({approvedCount})</button>
									</div>
								</div>

							{:else if stage === 'write' && proposal}
								<div class="space-y-5">
									<div class="rounded-2xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 p-6">
										<h2 class="text-base font-semibold text-amber-800 dark:text-amber-200">Writing to XPLAN — coming in Phase B</h2>
										<p class="text-sm text-amber-700 dark:text-amber-300 mt-2">
											The {approvedCount} approved item{approvedCount === 1 ? '' : 's'} below are ready. In Phase B, the agent will <span class="font-medium">fill</span> these into the XPLAN client form in the visible browser — but <span class="font-medium">you click Save</span>. Nothing is committed to XPLAN without your final click, and the guardrail must be unlocked first.
										</p>
									</div>
									<div class="rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
										<div class="px-4 py-2.5 bg-gray-50 dark:bg-gray-850 text-xs font-semibold uppercase tracking-wide text-gray-500">Approved for {proposal.client.name}</div>
										<div class="divide-y divide-gray-100 dark:divide-gray-800">
											{#each proposal.items.filter((i) => i.status === 'approved' || i.status === 'edited') as item}
												<div class="px-4 py-2.5 flex items-center gap-3 text-sm">
													<span class="w-40 shrink-0 text-gray-500">{item.field}</span>
													<span class="flex-1 font-medium truncate">{item.value}</span>
													<span class="text-xs text-gray-400">{item.xplanResource}</span>
												</div>
											{/each}
										</div>
									</div>
									<div class="flex items-center justify-between gap-3 pt-1">
										<button on:click={() => (stage = 'review')} class="text-sm text-gray-500 hover:text-black dark:hover:text-white">← Back to review</button>
										<p class="text-xs text-gray-400">When the entries are in XPLAN, tick this row done.</p>
									</div>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>

		<div class="flex items-center justify-between gap-3 mt-5">
			<button on:click={() => goto('/apps/discovery')} class="text-sm text-gray-500 hover:text-black dark:hover:text-white">← Discovery</button>
		</div>
		<p class="text-xs text-gray-400 mt-8">
			Phase A — extract &amp; propose only. The agent never writes to XPLAN here; it reads this client's documents in {DOCUMENTS_APP_NAME} and proposes values for your approval.
		</p>
	{/if}
</div>
