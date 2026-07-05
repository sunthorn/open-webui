<script lang="ts">
	// Search — find a client. Scaffold: the input is here; live client lookup
	// against XPLAN is wired up once the data source is connected.
	let q = '';
</script>

<div class="max-w-3xl mx-auto px-8 py-10">
	<div class="mb-6">
		<h1 class="text-2xl font-semibold tracking-tight">Search</h1>
		<p class="text-sm text-gray-500 mt-1">Find a client across your XPLAN book.</p>
	</div>

	<div class="relative">
		<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor" class="size-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
			<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
		</svg>
		<input
			bind:value={q}
			placeholder="Search by client name…"
			class="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 pl-11 pr-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10"
		/>
	</div>

	<div class="rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 p-8 text-center mt-5">
		<p class="text-sm text-gray-500">
			Client search connects to your live XPLAN book — coming next. For now, look up clients directly
			in XPLAN.
		</p>
	</div>
</div>
