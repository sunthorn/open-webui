<script lang="ts">
	// New Client Onboarding — Phase A (extract + propose + review; no write).
	// Wizard: Start → Upload → Review/Approve → Write (Phase B stub).
	// Nothing is written to XPLAN here — the agent only PROPOSES; the planner
	// approves. See docs/onboarding-build-plan.md.
	import { extractDocument, proposeMapping, type OnboardingProposal, type ProposalItem } from '$lib/apis/onboarding';
	import { saveOnboardingSession } from '$lib/apis/gateway';

	type Stage = 'start' | 'upload' | 'review' | 'write';
	let stage: Stage = 'start';

	let clientName = '';
	let clientMode: 'new' | 'existing' = 'new';

	let files: File[] = [];
	let dragging = false;

	let busy = false;
	let busyMsg = '';
	let error = '';

	let proposal: OnboardingProposal | null = null;
	let sessionId = '';

	const token = () => localStorage.getItem('token') ?? '';

	// --- session id (stable per wizard run) ---
	const newSessionId = () =>
		(crypto?.randomUUID?.() ?? `s-${Date.now()}-${Math.round(Math.random() * 1e6)}`).slice(0, 36);

	const startUpload = () => {
		if (!clientName.trim()) {
			error = 'Enter the client’s name first.';
			return;
		}
		error = '';
		sessionId = newSessionId();
		stage = 'upload';
	};

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
		const existing = new Set(files.map((f) => f.name + f.size));
		files = [...files, ...list.filter((f) => !existing.has(f.name + f.size))];
	};
	const removeFile = (i: number) => {
		files = files.filter((_, idx) => idx !== i);
	};

	const persist = async (stageVal: string) => {
		if (!proposal) return;
		try {
			await saveOnboardingSession(token(), sessionId, {
				sessionId,
				stage: stageVal,
				proposal,
				updatedAt: new Date().toISOString()
			});
		} catch (e) {
			// non-fatal: the review still works in-memory; surface quietly
			console.warn('Could not persist onboarding session:', e);
		}
	};

	const runProposal = async () => {
		if (!files.length) {
			error = 'Add at least one document.';
			return;
		}
		busy = true;
		error = '';
		try {
			const docs = [];
			for (const f of files) {
				busyMsg = `Extracting ${f.name}…`;
				docs.push(await extractDocument(token(), f));
			}
			busyMsg = 'Asking the agent to map the data to XPLAN…';
			proposal = await proposeMapping(token(), clientName.trim(), clientMode, docs);
			if (!proposal.items.length) {
				error = 'The agent found no mappable fields in these documents.';
			} else {
				stage = 'review';
				await persist('proposed');
			}
		} catch (e: any) {
			error = e?.message ?? 'Could not build the proposal.';
		} finally {
			busy = false;
			busyMsg = '';
		}
	};

	// --- review actions ---
	const setStatus = (item: ProposalItem, status: ProposalItem['status']) => {
		item.status = status;
		proposal = proposal; // trigger reactivity
	};
	const editValue = (item: ProposalItem, v: string) => {
		item.value = v;
		if (item.status === 'proposed') item.status = 'edited';
		proposal = proposal;
	};
	const approveAll = () => {
		if (!proposal) return;
		proposal.items.forEach((it) => {
			if (it.status !== 'rejected') it.status = 'approved';
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
		await persist('reviewed');
		stage = 'write';
	};

	const restart = () => {
		stage = 'start';
		clientName = '';
		files = [];
		proposal = null;
		error = '';
	};

	const confidenceClass = (c?: number) =>
		c == null
			? 'text-gray-400'
			: c >= 0.75
				? 'text-green-600 dark:text-green-400'
				: c >= 0.5
					? 'text-amber-600 dark:text-amber-400'
					: 'text-red-600 dark:text-red-400';
</script>

<div class="max-w-4xl mx-auto px-8 py-10">
	<!-- Header + step indicator -->
	<div class="mb-8">
		<h1 class="text-2xl font-semibold tracking-tight">New Client Onboarding</h1>
		<p class="text-sm text-gray-500 mt-1">
			Upload a client’s documents; the agent proposes what to enter into XPLAN. You approve every
			item — nothing is written without your say-so.
		</p>
		<div class="flex items-center gap-2 mt-5 text-xs font-medium">
			{#each [['start', 'Start'], ['upload', 'Upload'], ['review', 'Review'], ['write', 'Write']] as [key, label], i}
				{@const active = stage === key}
				{@const done = ['start', 'upload', 'review', 'write'].indexOf(stage) > i}
				<div class="flex items-center gap-2">
					<span
						class="size-6 rounded-full flex items-center justify-center text-[11px]
							{active ? 'bg-black text-white dark:bg-white dark:text-black' : done ? 'bg-gray-300 dark:bg-gray-700 text-white dark:text-black' : 'bg-gray-100 dark:bg-gray-800 text-gray-400'}"
					>{i + 1}</span>
					<span class={active ? 'text-black dark:text-white' : 'text-gray-400'}>{label}</span>
				</div>
				{#if i < 3}<span class="text-gray-300 dark:text-gray-700">→</span>{/if}
			{/each}
		</div>
	</div>

	{#if error}
		<div class="mb-5 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-3">
			{error}
		</div>
	{/if}

	<!-- STEP 1 — Start -->
	{#if stage === 'start'}
		<div class="rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-850 p-6 space-y-5">
			<div>
				<label class="block text-sm font-medium mb-1.5" for="client-name">Client name</label>
				<input
					id="client-name"
					bind:value={clientName}
					placeholder="e.g. Jane Citizen"
					class="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10"
					on:keydown={(e) => e.key === 'Enter' && startUpload()}
				/>
			</div>
			<div>
				<span class="block text-sm font-medium mb-1.5">Record</span>
				<div class="flex gap-2">
					<button
						on:click={() => (clientMode = 'new')}
						class="flex-1 rounded-xl border px-3.5 py-2.5 text-sm text-left transition
							{clientMode === 'new' ? 'border-black dark:border-white bg-white dark:bg-gray-900' : 'border-gray-200 dark:border-gray-700 text-gray-500'}"
					>
						<span class="font-medium">New client</span>
						<span class="block text-xs text-gray-400">Create a fresh XPLAN record (Phase B)</span>
					</button>
					<button
						on:click={() => (clientMode = 'existing')}
						class="flex-1 rounded-xl border px-3.5 py-2.5 text-sm text-left transition
							{clientMode === 'existing' ? 'border-black dark:border-white bg-white dark:bg-gray-900' : 'border-gray-200 dark:border-gray-700 text-gray-500'}"
					>
						<span class="font-medium">Existing client</span>
						<span class="block text-xs text-gray-400">Add to a record (lookup in Phase C)</span>
					</button>
				</div>
			</div>
			<button
				on:click={startUpload}
				class="w-full rounded-xl bg-black text-white dark:bg-white dark:text-black py-2.5 text-sm font-medium hover:opacity-90 transition"
			>
				Continue
			</button>
		</div>

	<!-- STEP 2 — Upload -->
	{:else if stage === 'upload'}
		<div class="space-y-4">
			<div
				role="button"
				tabindex="0"
				on:dragover|preventDefault={() => (dragging = true)}
				on:dragleave={() => (dragging = false)}
				on:drop={onDrop}
				class="rounded-2xl border-2 border-dashed p-10 text-center transition
					{dragging ? 'border-black dark:border-white bg-gray-50 dark:bg-gray-850' : 'border-gray-200 dark:border-gray-700'}"
			>
				<p class="text-sm text-gray-500">
					Drag fact-find, statements, or ID documents here, or
					<label class="text-black dark:text-white font-medium underline cursor-pointer">
						browse
						<input type="file" multiple class="hidden" on:change={onPick} />
					</label>
				</p>
				<p class="text-xs text-gray-400 mt-2">PDF, DOCX, XLSX, TXT. Scanned images need OCR configured.</p>
			</div>

			{#if files.length}
				<ul class="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
					{#each files as f, i}
						<li class="flex items-center justify-between px-4 py-3 text-sm">
							<span class="truncate">{f.name} <span class="text-gray-400">· {(f.size / 1024).toFixed(0)} KB</span></span>
							<button on:click={() => removeFile(i)} class="text-gray-400 hover:text-red-500 text-xs">Remove</button>
						</li>
					{/each}
				</ul>
			{/if}

			<div class="flex items-center justify-between gap-3 pt-1">
				<button on:click={() => (stage = 'start')} class="text-sm text-gray-500 hover:text-black dark:hover:text-white">← Back</button>
				<button
					on:click={runProposal}
					disabled={busy || !files.length}
					class="inline-flex items-center gap-2 rounded-xl bg-black text-white dark:bg-white dark:text-black px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-wait transition"
				>
					{#if busy}
						<svg class="size-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
						{busyMsg || 'Working…'}
					{:else}
						Extract & propose
					{/if}
				</button>
			</div>
		</div>

	<!-- STEP 3 — Review -->
	{:else if stage === 'review' && proposal}
		<div class="space-y-5">
			<div class="flex items-center justify-between gap-3">
				<div class="text-sm text-gray-500">
					<span class="font-medium text-black dark:text-white">{proposal.items.length}</span> proposed ·
					<span class="text-green-600 dark:text-green-400">{approvedCount} approved</span> ·
					<span class="text-red-500">{rejectedCount} rejected</span>
					<span class="block text-xs text-gray-400 mt-0.5">from {proposal.sourceDocs.join(', ')}</span>
				</div>
				<button on:click={approveAll} class="text-sm font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-850">
					Approve all
				</button>
			</div>

			{#if proposal.notes}
				<p class="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-4 py-3">
					⚠️ {proposal.notes}
				</p>
			{/if}

			{#each Object.entries(grouped) as [section, items]}
				<div class="rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
					<div class="px-4 py-2.5 bg-gray-50 dark:bg-gray-850 text-xs font-semibold uppercase tracking-wide text-gray-500">
						{section}
					</div>
					<div class="divide-y divide-gray-100 dark:divide-gray-800">
						{#each items as item}
							<div class="px-4 py-3 flex items-center gap-3 text-sm {item.status === 'rejected' ? 'opacity-40' : ''}">
								<div class="w-40 shrink-0">
									<div class="font-medium">{item.field}</div>
									<div class="text-xs text-gray-400">
										{item.xplanResource}{item.xplanField ? `.${item.xplanField}` : ''}
									</div>
								</div>
								<input
									value={item.value}
									on:input={(e) => editValue(item, (e.target as HTMLInputElement).value)}
									class="flex-1 min-w-0 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10"
								/>
								<span class="w-10 text-right text-xs {confidenceClass(item.confidence)}" title="agent confidence">
									{item.confidence != null ? Math.round(item.confidence * 100) + '%' : '—'}
								</span>
								<div class="flex gap-1 shrink-0">
									<button
										on:click={() => setStatus(item, item.status === 'rejected' ? 'proposed' : 'approved')}
										title="Approve"
										class="size-7 rounded-lg flex items-center justify-center transition
											{item.status === 'approved' || item.status === 'edited' ? 'bg-green-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 hover:text-green-600'}"
									>✓</button>
									<button
										on:click={() => setStatus(item, 'rejected')}
										title="Reject"
										class="size-7 rounded-lg flex items-center justify-center transition
											{item.status === 'rejected' ? 'bg-red-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 hover:text-red-600'}"
									>✕</button>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/each}

			<div class="flex items-center justify-between gap-3 pt-1">
				<button on:click={() => (stage = 'upload')} class="text-sm text-gray-500 hover:text-black dark:hover:text-white">← Back</button>
				<button
					on:click={toWrite}
					disabled={approvedCount === 0}
					class="rounded-xl bg-black text-white dark:bg-white dark:text-black px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
				>
					Continue to write ({approvedCount})
				</button>
			</div>
		</div>

	<!-- STEP 4 — Write (Phase B stub) -->
	{:else if stage === 'write' && proposal}
		<div class="space-y-5">
			<div class="rounded-2xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 p-6">
				<h2 class="text-base font-semibold text-amber-800 dark:text-amber-200">Writing to XPLAN — coming in Phase B</h2>
				<p class="text-sm text-amber-700 dark:text-amber-300 mt-2">
					The {approvedCount} approved item{approvedCount === 1 ? '' : 's'} below are ready. In Phase B, the
					agent will <span class="font-medium">fill</span> these into the XPLAN client form in the visible
					browser — but <span class="font-medium">you click Save</span>. Nothing is committed to XPLAN
					without your final click, and the guardrail must be unlocked first.
				</p>
			</div>

			<div class="rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
				<div class="px-4 py-2.5 bg-gray-50 dark:bg-gray-850 text-xs font-semibold uppercase tracking-wide text-gray-500">
					Approved for {proposal.client.name}
				</div>
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
				<button on:click={restart} class="rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-850">
					Start another
				</button>
			</div>
		</div>
	{/if}

	<p class="text-xs text-gray-400 mt-8">
		Phase A — extract &amp; propose only. The agent never writes to XPLAN here; it reads your uploaded
		documents and proposes values for your approval (read-only against live client data).
	</p>
</div>
