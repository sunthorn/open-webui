// Stage pages' shared logic — rows, gating, running-job lookup, chips.
// Pure: the Svelte pages render these; nothing here fetches.
// Spec: docs/superpowers/specs/2026-10-08-client-onboarding-design.md §5.4.
import { GatewayError } from '$lib/apis/gateway';
import type { JobsSnapshot, SyncJob } from '$lib/apis/gateway/jobs';
import type { AgendaEvent, AgendaSource } from '$lib/apis/gateway/agenda';
import { isoDate } from '$lib/apis/gateway/agenda';
import { allDayOn } from '$lib/apps/agenda';
import type {
	ActionStatus,
	OnboardingAction,
	OnboardingContact,
	OnboardingState,
	Stage,
	Step
} from '$lib/apis/gateway/onboarding';

export interface EnquiryRow {
	step: Step;
	title: string;
	detail: string;
	kind: 'document' | 'booking';
}

export const ENQUIRY_ROWS: EnquiryRow[] = [
	{
		step: 'enquiry.welcome_pack',
		title: 'Welcome Pack',
		kind: 'document',
		detail:
			'Drafted from the Welcome Pack template into the client’s folder, then emailed from your mailbox. Done at send.'
	},
	{
		step: 'enquiry.fsg',
		title: 'FSG',
		kind: 'document',
		detail:
			'Financial Services Guide — drafted into the client’s folder, then emailed from your mailbox. Done at send.'
	},
	{
		step: 'enquiry.fact_find',
		title: 'Fact Find',
		kind: 'document',
		detail: 'Drafted into the client’s folder, then emailed from your mailbox. Done at send.'
	},
	{
		step: 'enquiry.discovery_meeting',
		title: 'Book Discovery Meeting',
		kind: 'booking',
		detail:
			'Pick an hour on your calendar; the invite goes to the client. Done when they accept.'
	}
];

export const DOCUMENT_STEPS: Step[] = ['enquiry.welcome_pack', 'enquiry.fsg', 'enquiry.fact_find'];
export const BOOK_STEP: Step = 'enquiry.discovery_meeting';

export const STAGE_LABEL: Record<Stage, string> = {
	enquiry: 'New Client Enquiry',
	discovery: 'Discovery Meeting',
	data_entry: 'Data Entry & Research',
	strategy: 'Strategy Development',
	advice_prep: 'Advice Preparation',
	advice_presentation: 'Advice Presentation',
	implementation: 'Implementation',
	ongoing: 'Ongoing Service',
	archive: 'Record & Archive'
};

/** Where a lead's stage opens. Stages without a page open the client detail. */
export const STAGE_PAGE: Partial<Record<Stage, string>> = {
	enquiry: '/apps/enquiry',
	discovery: '/apps/discovery',
	data_entry: '/apps/data-entry'
};

export const byStep = (actions: OnboardingAction[]): Map<string, OnboardingAction> =>
	new Map(actions.map((a) => [a.step, a]));

const has = (a: OnboardingAction | undefined, ...statuses: ActionStatus[]): boolean =>
	!!a && statuses.includes(a.status);

/** Book Discovery Meeting is enabled once the three documents are sent or done. */
export const canBook = (actions: OnboardingAction[]): boolean => {
	const m = byStep(actions);
	return DOCUMENT_STEPS.every((s) => has(m.get(s), 'sent', 'done'));
};

/** Continue to Discovery needs all four done. */
export const canContinue = (actions: OnboardingAction[]): boolean => {
	const m = byStep(actions);
	return ENQUIRY_ROWS.every((r) => has(m.get(r.step), 'done'));
};

export const doneCount = (actions: OnboardingAction[], stage: Stage): number =>
	actions.filter((a) => a.step.startsWith(`${stage}.`) && a.status === 'done').length;

/**
 * On open, every pending document row whose template exists is drafted
 * (spec §5.4, amendment R14) — unless salem says there is no drive, when
 * each would only fail with no_client_folder. A missing `templates` map
 * means the gateway did not say: do not draft blind. A `failed` row is
 * never re-run automatically: its message is the point. Only a row that
 * was never drafted or sent: a `pending` row with a draftRef or emailRef
 * is an untick, which means "not done yet", not "make a new document" —
 * the explicit Draft button is still there for that.
 */
export const autoDraftSteps = (state: OnboardingState | null): Step[] => {
	if (!state || state.drive.connected === false) return [];
	const templates = state.templates;
	if (!templates) return [];
	return state.actions
		.filter(
			(a) =>
				a.status === 'pending' &&
				!a.draftRef &&
				!a.emailRef &&
				DOCUMENT_STEPS.includes(a.step) &&
				templates[a.step] === true &&
				// More than one to choose from: the planner picks, not the page.
				!state.pickTemplate?.[a.step]
		)
		.map((a) => a.step);
};

export const emailOf = (a: OnboardingAction) =>
	(a.detail?.email as
		| { subject?: string; html?: string; text?: string; to?: string | null }
		| undefined) ?? null;

export const errorOf = (a: OnboardingAction) =>
	(a.detail?.error as { code?: string; message?: string } | undefined) ?? null;

export const slotOf = (a: OnboardingAction) =>
	(a.detail?.slot as { start: string; end: string; label: string } | undefined) ?? null;

const RSVP_LABEL: Record<string, string> = { none: 'Awaiting reply', tentative: 'Tentative', declined: 'Declined' };

/**
 * The booked invite as the row shows it: a link to the event in the planner's
 * calendar (contact-layer passes only https links to the provider's own host;
 * checked again here because it lands in an href) and the client's latest
 * reply. An accept completes the row, so a done row reads "Accepted".
 */
export const bookingOf = (a: OnboardingAction) => {
	const d = a.detail ?? {};
	const raw = typeof d.web_link === 'string' ? d.web_link : '';
	const link = raw.startsWith('https://') ? raw : null;
	const where = d.provider === 'google' ? 'Google Calendar' : 'Outlook';
	const booked = (d.evidence as { kind?: string } | undefined)?.kind === 'booked';
	const reply =
		a.status === 'done'
			? booked
				? 'Booked by the client'
				: 'Accepted'
			: d.mode === 'link'
				? null
				: (RSVP_LABEL[String(d.rsvp ?? 'none')] ?? null);
	return { link, where, reply, declined: d.rsvp === 'declined' && a.status !== 'done' };
};

// --- the booking link (docs/superpowers/specs/2026-10-12-booking-link-design.md) ---

/** The row was booked by mailing the planner's booking page: who it went to. */
export const linkSentOf = (a: OnboardingAction) => {
	const d = a.detail ?? {};
	if (d.mode !== 'link') return null;
	return { to: typeof d.sent_to === 'string' ? d.sent_to : null };
};

/** "Fri 16 Oct, 11:00 AM" — the slot labels' format, in the planner's zone. */
const meetingLabel = (iso: string, timeZone?: string): string | null => {
	const t = new Date(iso);
	if (Number.isNaN(t.getTime())) return null;
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-AU', {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: 'numeric',
			minute: '2-digit',
			hour12: true,
			timeZone
		})
			.formatToParts(t)
			.map((p) => [p.type, p.value])
	);
	return `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toUpperCase()}`;
};

/** A meeting the client booked on the planner's page (onb_detect's evidence). */
export const bookedByClientOf = (a: OnboardingAction, timeZone?: string) => {
	const ev = a.detail?.evidence as { kind?: string; start?: string } | undefined;
	if (a.status !== 'done' || ev?.kind !== 'booked' || typeof ev.start !== 'string') return null;
	const label = meetingLabel(ev.start, timeZone);
	return label ? { label } : null;
};

const escapeHtml = (s: string) =>
	s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** XPLAN names read "Surname, First"; anything else is "First Surname". */
const firstName = (name: string): string => {
	const n = name.includes(',') ? name.split(',')[1] : name;
	return (n ?? '').trim().split(/\s+/)[0] ?? '';
};

/**
 * The fixed, editable booking-link email. The link itself is added by the
 * gateway when it sends — the body never carries one (it would be stripped).
 */
export const bookingLinkEmail = (clientName: string) => {
	const first = firstName(clientName).replace(/[<>&"']/g, '') || 'there';
	return {
		subject: 'Book your discovery meeting',
		html:
			`<p>Hi ${escapeHtml(first)},</p>` +
			'<p>Thank you for sending through your documents. Please choose a time that suits you ' +
			'for our discovery meeting using the link below.</p>'
	};
};

/**
 * Who Send mails: the address the draft recorded, else the client's current
 * email from the last XPLAN sync (onb_send works it out again at send time,
 * so an email added after drafting needs no Regenerate).
 */
export const recipientOf = (a: OnboardingAction, contact?: OnboardingContact | null): string | null =>
	emailOf(a)?.to || contact?.email || null;

export const canSend = (a: OnboardingAction, contact?: OnboardingContact | null): boolean =>
	a.status === 'ready' && !!recipientOf(a, contact);

/** Why Send is off on a ready row: no address on the draft or the XPLAN record. */
export const NO_EMAIL_HINT =
	'No email on file. Add a Home or Work Email in XPLAN, then click Re-read from XPLAN on the client page.';

/**
 * Which Send a document row offers (onboarding-stages.md §4 send gate):
 * `send` on ready; `again` on sent, or on a failed row that was ever sent
 * (has an emailRef); `retry` on a failed row that kept its draft and was
 * never sent (a send-side failure); `unrecorded` when the mail went out but the
 * row could not say so — only an explicit "Send again" is offered then,
 * because a plain retry would mail the client twice.
 */
export type SendMode = 'send' | 'again' | 'retry' | 'unrecorded';

export const sendModeOf = (a: OnboardingAction): SendMode | null => {
	if (a.status === 'ready') return 'send';
	if (a.status === 'sent') return 'again';
	if (a.status === 'failed' && a.draftRef) {
		if (errorOf(a)?.code === 'sent_unrecorded') return 'unrecorded';
		// Sent before (a Regenerate that then failed): a plain Send would mail
		// the client the same document twice.
		return a.emailRef ? 'again' : 'retry';
	}
	return null;
};

/** Does this Send carry `args.again`? */
export const sendsAgain = (mode: SendMode): boolean => mode === 'again' || mode === 'unrecorded';

/**
 * A booking on a booked row (sent/done, or booked-but-unrecorded) must say
 * `again`: it is the explicit second invite. A row holding an eventRef has an invite out whatever its status (an
 * untick keeps it), so it counts as booked too.
 */
export const pickNeedsAgain = (a: OnboardingAction): boolean =>
	!!a.eventRef ||
	a.status === 'sent' ||
	a.status === 'done' ||
	(a.status === 'failed' && errorOf(a)?.code === 'sent_unrecorded');

// --- booking an hour (Book discovery meeting window) ---

const HOUR = 3_600_000;
/** How far ahead onb_book takes a slot. */
const BOOK_AHEAD_DAYS = 90;

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The hour `d` falls in, as onb_book's `slot.start`: local wall time with the
 * browser's offset ("2026-10-15T09:00:00+11:00"), minutes dropped.
 */
export const hourSlotStart = (d: Date): string => {
	const h = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours());
	const off = -h.getTimezoneOffset();
	const sign = off < 0 ? '-' : '+';
	const abs = Math.abs(off);
	return (
		`${h.getFullYear()}-${pad(h.getMonth() + 1)}-${pad(h.getDate())}T${pad(h.getHours())}:00:00` +
		`${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
	);
};

/** Why an hour cannot be booked; null when it can. */
export type HourBlock =
	| { kind: 'past' }
	| { kind: 'too_far' }
	| { kind: 'busy'; events: AgendaEvent[] };

/**
 * An hour is not bookable when it has started, is past onb_book's horizon,
 * overlaps a timed event, or falls on a day an all-day event covers. Edges
 * that only touch (an event ending at 9:00 against 9–10) do not overlap.
 */
export const hourBlock = (hour: Date, events: AgendaEvent[], now: Date): HourBlock | null => {
	const start = hour.getTime();
	const end = start + HOUR;
	if (start <= now.getTime()) return { kind: 'past' };
	if (start > now.getTime() + BOOK_AHEAD_DAYS * 24 * HOUR) return { kind: 'too_far' };
	const busy = [
		...allDayOn(events, isoDate(hour)),
		...events.filter((e) => {
			if (e.allDay) return false;
			const s = Date.parse(e.startAt);
			const en = Math.max(s, Date.parse(e.endAt || e.startAt));
			// A zero-length event still holds the hour it sits in.
			return s < end && (en > start || s >= start);
		})
	];
	return busy.length ? { kind: 'busy', events: busy } : null;
};

export const isHourBookable = (hour: Date, events: AgendaEvent[], now: Date): boolean =>
	hourBlock(hour, events, now) === null;

export const OUTLOOK_CALENDAR = { label: 'Open Outlook calendar', href: 'https://outlook.office.com/calendar/' };
export const GOOGLE_CALENDAR = { label: 'Open Google Calendar', href: 'https://calendar.google.com/' };

/** Where to free a busy hour: the busy events' own calendars, or both when unsure. */
export const calendarLinksFor = (sources: (AgendaSource | string)[]) => {
	const m365 = sources.includes('m365');
	const google = sources.includes('google');
	const unsure = !sources.length || sources.some((s) => s !== 'm365' && s !== 'google');
	return [
		...(m365 || unsure ? [OUTLOOK_CALENDAR] : []),
		...(google || unsure ? [GOOGLE_CALENDAR] : [])
	];
};

/** onb_book's slot_busy refusal, by its text (a job carries text, not the code). */
export const isSlotBusy = (text: string | null | undefined): boolean =>
	!!text && /^That hour is busy/i.test(text.trim());

/** "Thu 15 Oct, 9:00–10:00 AM" — the hour from `hour`, in the planner's zone. */
export const hourRangeLabel = (hour: Date, timeZone?: string): string => {
	const fmt = new Intl.DateTimeFormat('en-AU', {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		hour: 'numeric',
		minute: '2-digit',
		hour12: true,
		timeZone
	});
	const parts = (d: Date) =>
		Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value])) as Record<string, string>;
	const s = parts(hour);
	const e = parts(new Date(hour.getTime() + HOUR));
	const sp = String(s.dayPeriod).toUpperCase();
	const ep = String(e.dayPeriod).toUpperCase();
	const day = `${s.weekday} ${s.day} ${s.month}`;
	return sp === ep
		? `${day}, ${s.hour}:${s.minute}–${e.hour}:${e.minute} ${ep}`
		: `${day}, ${s.hour}:${s.minute} ${sp}–${e.hour}:${e.minute} ${ep}`;
};

/** A gateway refusal as the planner should read it. */
export const actionMessage = (e: unknown): string => {
	if (e instanceof GatewayError && e.status === 503 && e.message === 'identity_unavailable')
		return 'axi could not act as you — sign out and back in, then try again.';
	return e instanceof Error ? e.message : String(e);
};

const BUSY = 'Another send or booking for this step is already running';

/**
 * Why a finished onboarding job refused, in planner words — or null when it
 * did not fail. A refusal (busy, already sent/booked, bad or busy slot) fails only
 * the job and leaves the row untouched, so without this the click looks
 * like it did nothing. The job carries the message text, not the code.
 */
export const jobRefusal = (snap: JobsSnapshot, jobId: string): string | null => {
	const job = Object.values(snap.last).find((j) => j?.id === jobId);
	if (!job || job.status !== 'error' || !job.error) return null;
	const text = job.error.trim();
	if (/^Another send or booking|^Could not take the send lock/.test(text)) return BUSY;
	if (/^Already booked/.test(text))
		return 'Already booked — use Book again to send a second invite';
	if (/^Already sent/.test(text)) return 'Already sent — use Send again';
	return text;
};

/** The onboarding job queued or running for this client and step, if any. */
export const runningFor = (snap: JobsSnapshot, client: string, step: string): SyncJob | undefined =>
	snap.running.find(
		(j) => j.kind.startsWith('onb_') && j.params?.client === client && j.params?.step === step
	);

/**
 * A `drafting` row with no running onb_draft job is stuck (cancelled before
 * it started, queue lost; amendment R6) — the page offers "Try again".
 */
export const isStuckDrafting = (a: OnboardingAction, snap: JobsSnapshot, client: string): boolean =>
	a.status === 'drafting' &&
	!snap.running.some(
		(j) => j.kind === 'onb_draft' && j.params?.client === client && j.params?.step === a.step
	);

export const STATUS_CHIP: Record<ActionStatus, { label: string; class: string }> = {
	pending: {
		label: 'To do',
		class: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
	},
	drafting: {
		label: 'Drafting…',
		class: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
	},
	ready: {
		label: 'Ready to send',
		class: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
	},
	sent: {
		label: 'Sent',
		class: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
	},
	done: {
		label: 'Done',
		class: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
	},
	failed: {
		label: 'Needs attention',
		class: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
	}
};
