<script lang="ts">
	// The hour grid behind Day, Work week and Week: sticky day headers, an
	// all-day row where multi-day events span columns, overlapping events side
	// by side, the now-line, and drag to move / drag the bottom edge to
	// resize. Layout and drag maths are pure ($lib/apps/agendaCalendar.ts);
	// this only measures pointers and draws. A drop only dispatches `move` —
	// the page confirms and calls the API.
	import { createEventDispatcher, onDestroy, tick } from 'svelte';
	import type { AgendaEvent } from '$lib/apis/gateway/agenda';
	import { SOURCE_META } from '$lib/apps/agenda';
	import {
		layoutDay,
		layoutSpanning,
		blockGeometry,
		minuteOfDay,
		minutesAt,
		dropStart,
		movedTimes,
		resizedTimes,
		timesChanged,
		snap,
		hhmm,
		minLabel,
		parseDay,
		weekdayShort,
		isWeekend,
		SNAP_MIN,
		type TimedBlock
	} from '$lib/apps/agendaCalendar';

	export let days: string[];
	export let events: AgendaEvent[] = [];
	export let today: string;
	export let now: Date;
	export let selectedId: string | null = null;
	/** The hour to open at, and a key that changes when the grid should scroll to it again. */
	export let scrollHour = 7;
	export let scrollKey = '';
	export let loading = false;

	const dispatch = createEventDispatcher<{
		select: AgendaEvent;
		move: { event: AgendaEvent; startAt: string; endAt: string };
		pickDay: string;
	}>();

	const HOUR = 48; // px per hour
	const LANE = 22; // px per all-day lane
	const MIN_MIN = 20; // shortest block, in minutes of height
	const hours = Array.from({ length: 24 }, (_, h) => h);

	$: blocks = days.map((d) => layoutDay(events, d, MIN_MIN));
	$: spans = layoutSpanning(events, days);
	$: lanes = spans.reduce((n, s) => Math.max(n, s.lane + 1), 0);
	$: empty = !loading && spans.length === 0 && blocks.every((b) => b.length === 0);
	$: nowMin = minuteOfDay(now, today);
	$: todayIdx = days.indexOf(today);
	$: cols = `3.5rem repeat(${days.length}, minmax(0, 1fr))`;
	$: wide = days.length > 1;

	// --- scrolling to the opening hour ------------------------------------------
	let scroller: HTMLDivElement;
	let scrolledFor = '';
	$: if (scroller && scrollKey !== scrolledFor) {
		scrolledFor = scrollKey;
		void tick().then(() => {
			if (scroller) scroller.scrollTop = Math.max(0, scrollHour * HOUR - 8);
		});
	}

	// --- drag to move / resize ---------------------------------------------------------
	let colEls: HTMLDivElement[] = [];
	interface Drag {
		mode: 'move' | 'resize';
		event: AgendaEvent;
		pointerId: number;
		x0: number;
		y0: number;
		grab: number; // minutes between the block's top and the pointer
		dur: number; // minutes
		active: boolean;
		col: number;
		startMin: number;
		endMin: number;
		pointerMin: number;
		el: HTMLElement;
	}
	let drag: Drag | null = null;
	let suppressClick = false;

	const draggable = (b: TimedBlock) =>
		b.event.writable && !b.event.allDay && !b.continuesBefore && !b.continuesAfter;

	const pointerAt = (x: number, y: number): { col: number; min: number } => {
		let col = 0;
		for (let i = 0; i < colEls.length; i++) {
			const r = colEls[i]?.getBoundingClientRect();
			if (!r) continue;
			if (x >= r.left) col = i;
		}
		const r = colEls[col]?.getBoundingClientRect();
		return { col, min: r ? minutesAt(y - r.top, HOUR) : 0 };
	};

	const begin = (e: PointerEvent, b: TimedBlock, dayIdx: number, mode: 'move' | 'resize') => {
		if (e.button !== 0 || !draggable(b)) return;
		e.stopPropagation();
		const el = e.currentTarget as HTMLElement;
		const p = pointerAt(e.clientX, e.clientY);
		drag = {
			mode,
			event: b.event,
			pointerId: e.pointerId,
			x0: e.clientX,
			y0: e.clientY,
			grab: p.min - b.startMin,
			dur: b.endMin - b.startMin,
			active: false,
			col: dayIdx,
			startMin: b.startMin,
			endMin: b.endMin,
			pointerMin: p.min,
			el
		};
		el.setPointerCapture?.(e.pointerId);
	};

	const onMove = (e: PointerEvent) => {
		if (!drag || e.pointerId !== drag.pointerId) return;
		if (!drag.active) {
			if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
			drag.active = true;
		}
		e.preventDefault();
		// Nudge the grid when the pointer nears its top or bottom edge.
		const r = scroller.getBoundingClientRect();
		if (e.clientY < r.top + 32) scroller.scrollTop -= 12;
		else if (e.clientY > r.bottom - 32) scroller.scrollTop += 12;
		const p = pointerAt(e.clientX, e.clientY);
		drag.pointerMin = p.min;
		if (drag.mode === 'move') {
			drag.col = p.col;
			drag.startMin = dropStart(p.min, drag.grab);
			drag.endMin = drag.startMin + drag.dur;
		} else {
			drag.endMin = Math.min(24 * 60, Math.max(snap(p.min), drag.startMin + SNAP_MIN));
		}
		drag = drag;
	};

	const end = (e: PointerEvent) => {
		if (!drag || e.pointerId !== drag.pointerId) return;
		const d = drag;
		drag = null;
		d.el.releasePointerCapture?.(d.pointerId);
		if (!d.active) return; // a plain click: on:click selects
		suppressClick = true;
		setTimeout(() => (suppressClick = false), 0);
		const t =
			d.mode === 'move'
				? movedTimes(d.event, days[d.col], d.startMin)
				: resizedTimes(d.event, d.endMin);
		if (timesChanged(d.event, t)) dispatch('move', { event: d.event, ...t });
	};

	const cancel = () => {
		if (!drag) return;
		drag.el.releasePointerCapture?.(drag.pointerId);
		if (drag.active) {
			suppressClick = true;
			setTimeout(() => (suppressClick = false), 0);
		}
		drag = null;
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === 'Escape' && drag) {
			e.preventDefault();
			e.stopPropagation();
			cancel();
		}
	};
	onDestroy(cancel);

	const pick = (e: AgendaEvent) => {
		if (!suppressClick) dispatch('select', e);
	};

	// --- drawing --------------------------------------------------------------------------
	const blockStyle = (b: TimedBlock) => {
		const top = (b.startMin / 60) * HOUR;
		const h = Math.max((MIN_MIN / 60) * HOUR, ((b.endMin - b.startMin) / 60) * HOUR) - 2;
		const { left, width } = blockGeometry(b);
		return `top:${top}px;height:${h}px;left:calc(${left}% + 1px);width:calc(${width}% - 4px);background:${SOURCE_META[b.event.source].color}`;
	};
	const blockPx = (b: TimedBlock) => ((b.endMin - b.startMin) / 60) * HOUR;
	const label = (e: AgendaEvent) =>
		`${e.title}, ${hhmm(e.startAt)} to ${hhmm(e.endAt || e.startAt)}${e.client ? `, ${e.client.name}` : ''}, ${SOURCE_META[e.source].label}${e.writable && !e.allDay ? ', drag to move' : ''}`;
	const past = (e: AgendaEvent) => Date.parse(e.endAt || e.startAt) < now.getTime();
</script>

<svelte:window on:keydown={onKey} />

<div
	bind:this={scroller}
	class="relative h-[min(40rem,70vh)] overflow-auto rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 {drag?.active
		? 'select-none'
		: ''}"
	role="region"
	aria-label="Calendar time grid"
	on:pointermove={onMove}
	on:pointerup={end}
	on:pointercancel={cancel}
>
	<div class={wide ? 'min-w-[36rem]' : ''}>
		<!-- Sticky day headers + all-day row -->
		<div
			class="sticky top-0 z-30 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-b border-gray-100 dark:border-gray-800"
		>
			<div class="grid" style="grid-template-columns:{cols}">
				<div></div>
				{#each days as d (d)}
					<div
						class="py-1.5 text-center {isWeekend(d) ? 'text-gray-400' : 'text-gray-500'}"
						role="columnheader"
						aria-label={parseDay(d).toDateString()}
					>
						<span class="text-[11px] uppercase tracking-wide">{weekdayShort(d)}</span>
						<button
							type="button"
							class="ml-1 inline-flex items-center justify-center min-w-7 h-7 px-1 rounded-full text-sm tabular-nums transition
								{d === today
								? 'bg-red-600 text-white font-semibold'
								: 'text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'}"
							aria-label="Open {parseDay(d).toDateString()} in Day view"
							on:click={() => dispatch('pickDay', d)}>{parseDay(d).getDate()}</button
						>
					</div>
				{/each}
			</div>
			<div
				class="grid border-t border-gray-100 dark:border-gray-800"
				style="grid-template-columns:{cols}"
			>
				<div class="text-[10px] text-gray-400 text-right pr-2 pt-1">all day</div>
				<div
					class="relative"
					style="grid-column: 2 / span {days.length}; height:{Math.max(1, lanes) * LANE + 6}px"
				>
					{#each days as d, i (d)}
						<div
							class="absolute top-0 bottom-0 border-l border-gray-100 dark:border-gray-800 {d ===
							today
								? 'bg-red-50/40 dark:bg-red-950/10'
								: ''}"
							style="left:{(i / days.length) * 100}%;width:{100 / days.length}%"
						></div>
					{/each}
					{#each spans as s (s.event.id)}
						<button
							type="button"
							class="absolute h-[20px] px-1.5 text-[11px] leading-[20px] text-white text-left truncate shadow-sm hover:brightness-110
								{s.continuesBefore ? 'rounded-l-none' : 'rounded-l-md'} {s.continuesAfter
								? 'rounded-r-none'
								: 'rounded-r-md'}
								{selectedId === s.event.id
								? 'ring-2 ring-offset-1 ring-gray-900 dark:ring-white dark:ring-offset-gray-900'
								: ''}"
							style="top:{3 + s.lane * LANE}px;left:calc({(s.startCol / days.length) *
								100}% + 2px);width:calc({(s.span / days.length) *
								100}% - 4px);background:{SOURCE_META[s.event.source].color}"
							title={s.event.title}
							aria-label="{s.event.title}, all day{s.event.client
								? `, ${s.event.client.name}`
								: ''}"
							on:click={() => pick(s.event)}
							>{#if s.continuesBefore}{'‹ '}{/if}{s.event.title}{#if s.event.client}<span
									class="opacity-80">{` · ${s.event.client.name}`}</span
								>{/if}</button
						>
					{/each}
				</div>
			</div>
			{#if empty}
				<p
					class="text-center text-xs text-gray-400 py-1.5 border-t border-gray-100 dark:border-gray-800"
				>
					Nothing scheduled
				</p>
			{/if}
		</div>

		<!-- Hours -->
		<div class="grid relative" style="grid-template-columns:{cols};height:{24 * HOUR}px">
			<div class="relative">
				{#each hours as h}
					{#if h > 0}
						<span
							class="absolute right-2 -translate-y-1/2 text-[10px] text-gray-400 tabular-nums"
							style="top:{h * HOUR}px">{String(h).padStart(2, '0')}:00</span
						>
					{/if}
				{/each}
			</div>
			<!-- hour and half-hour lines across every day column -->
			<div class="absolute inset-y-0 right-0 left-14 pointer-events-none" aria-hidden="true">
				{#each hours as h}
					<div
						class="absolute inset-x-0 border-t border-gray-100 dark:border-gray-800"
						style="top:{h * HOUR}px"
					></div>
					<div
						class="absolute inset-x-0 border-t border-dashed border-gray-50 dark:border-gray-850"
						style="top:{h * HOUR + HOUR / 2}px"
					></div>
				{/each}
			</div>

			{#each days as d, i (d)}
				<div
					bind:this={colEls[i]}
					class="relative border-l border-gray-100 dark:border-gray-800 {d === today
						? 'bg-red-50/30 dark:bg-red-950/10'
						: isWeekend(d)
							? 'bg-gray-50/50 dark:bg-gray-850/30'
							: ''}"
				>
					{#each blocks[i] ?? [] as b (b.event.id)}
						{@const px = blockPx(b)}
						{@const canDrag = draggable(b)}
						{@const dragging = drag?.active && drag.event.id === b.event.id}
						<button
							type="button"
							class="group absolute z-10 rounded-md text-left text-white shadow-sm overflow-hidden border border-white/40 dark:border-gray-900/60
								transition-[filter,opacity] hover:brightness-110 hover:z-20
								{canDrag ? 'cursor-grab active:cursor-grabbing touch-none' : 'cursor-default'}
								{px < 28 ? 'px-1.5 py-0' : 'px-1.5 py-0.5'}
								{dragging ? 'opacity-40' : past(b.event) ? 'opacity-75' : ''}
								{selectedId === b.event.id
								? 'ring-2 ring-offset-1 ring-gray-900 dark:ring-white dark:ring-offset-gray-900 z-20'
								: ''}
								{b.continuesBefore ? 'rounded-t-none' : ''} {b.continuesAfter ? 'rounded-b-none' : ''}"
							style={blockStyle(b)}
							title={label(b.event)}
							aria-label={label(b.event)}
							on:pointerdown={(e) => begin(e, b, i, 'move')}
							on:click={() => pick(b.event)}
						>
							{#if px < 28}
								<span class="block truncate text-[11px] leading-[15px]"
									><span class="font-medium">{b.event.title}</span>
									<span class="opacity-80">{hhmm(b.event.startAt)}</span></span
								>
							{:else}
								<span class="block truncate text-xs font-medium leading-4">{b.event.title}</span>
								<span class="block truncate text-[11px] opacity-85 leading-4 tabular-nums"
									>{hhmm(b.event.startAt)} – {hhmm(
										b.event.endAt || b.event.startAt
									)}{#if px < 52 && b.event.client}{` · ${b.event.client.name}`}{/if}</span
								>
								{#if px >= 52 && b.event.client}
									<span class="block truncate text-[11px] opacity-85 leading-4"
										>{b.event.client.name}</span
									>
								{/if}
								{#if px >= 68 && b.event.location}
									<span class="block truncate text-[11px] opacity-70 leading-4"
										>{b.event.location}</span
									>
								{/if}
							{/if}
							{#if canDrag && px >= 20}
								<!-- svelte-ignore a11y-no-static-element-interactions -->
								<div
									class="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize opacity-0 group-hover:opacity-100 flex justify-center"
									on:pointerdown={(e) => begin(e, b, i, 'resize')}
								>
									<span class="w-6 h-0.5 mt-0.5 rounded bg-white/80"></span>
								</div>
							{/if}
						</button>
					{/each}

					{#if drag?.active && drag.col === i}
						<div
							class="absolute z-30 left-0.5 right-1 rounded-md border-2 border-dashed pointer-events-none px-1.5 py-0.5 text-[11px] font-medium shadow-lg bg-white/85 dark:bg-gray-900/85"
							style="top:{(drag.startMin / 60) * HOUR}px;height:{Math.max(
								(MIN_MIN / 60) * HOUR,
								((drag.endMin - drag.startMin) / 60) * HOUR
							) - 2}px;border-color:{SOURCE_META[drag.event.source].color};color:{SOURCE_META[
								drag.event.source
							].color}"
						>
							<span class="block truncate">{drag.event.title}</span>
							<span class="block tabular-nums"
								>{minLabel(drag.startMin)} – {minLabel(drag.endMin)}</span
							>
						</div>
					{/if}

					{#if i === todayIdx}
						<div
							class="absolute -left-1 right-0 z-20 pointer-events-none flex items-center"
							style="top:{(nowMin / 60) * HOUR}px"
							aria-label="Now, {hhmm(now)}"
						>
							<span class="size-2.5 -mt-[5px] rounded-full bg-red-600"></span>
							<span class="flex-1 h-0.5 -mt-0.5 bg-red-600"></span>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>
</div>

<p class="mt-1 h-4 text-[11px] text-gray-400" aria-live="polite">
	{#if drag?.active}
		{drag.mode === 'move' ? 'Moving to' : 'Ending at'}
		{drag.mode === 'move'
			? `${parseDay(days[drag.col]).toDateString()} ${minLabel(drag.startMin)}`
			: minLabel(drag.endMin)} · release to confirm · Esc to cancel
	{/if}
</p>
