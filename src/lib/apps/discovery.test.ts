import { describe, it, expect } from 'vitest';
import {
	stageAtLeast,
	analysisOf,
	previousOf,
	changedCount,
	newSinceLastRun,
	lastRunAt,
	skippedStores,
	confidenceLabel,
	discoveryDone,
	isAnalysing,
	analyseOutcome,
	mergeNoteDrafts,
	notesToKeep,
	stepId
} from './discovery';

const analysis = (over: Partial<any> = {}) => ({
	findings: ['a'],
	confidence: 0.5,
	open_questions: [],
	run_at: '2026-10-08T01:00:00Z',
	model: 'm',
	sources: { xplan: 1, documents: 0, meetings: 0, notes: 0, passages: 0, activity: 0 },
	skipped: [],
	source_index: {},
	...over
});
const action = (step: string, status = 'ready', detail: any = {}) => ({ step, status, detail }) as any;

describe('stageAtLeast', () => {
	it('orders stages as the process map does', () => {
		expect(stageAtLeast('discovery', 'discovery')).toBe(true);
		expect(stageAtLeast('data_entry', 'discovery')).toBe(true);
		expect(stageAtLeast('enquiry', 'discovery')).toBe(false);
		expect(stageAtLeast(null, 'discovery')).toBe(false);
		expect(stageAtLeast('bogus', 'discovery')).toBe(false);
	});
});

describe('analysis readers', () => {
	const actions = [
		action('discovery.clarify_goals', 'ready', { analysis: analysis({ run_at: '2026-10-08T01:00:00Z' }), changed_since: ['finny:d1', 'salem:note:n1'] }),
		action('discovery.collect_info', 'done', { analysis: analysis({ skipped: ['finny refused the planner'] }), changed_since: ['finny:d1'] }),
		action('discovery.define_scope', 'pending'),
		action('discovery.risk_profile', 'pending')
	];

	it('reads the analysis or null', () => {
		expect(analysisOf(actions[0])?.findings).toEqual(['a']);
		expect(analysisOf(actions[2])).toBeNull();
		expect(analysisOf(undefined)).toBeNull();
	});

	it('reads the previous run or null', () => {
		const prev = { findings: ['old'], confidence: 0.2, open_questions: ['q'], run_at: 'x', model: 'm', sources: {}, skipped: [] };
		expect(previousOf(action('discovery.clarify_goals', 'ready', { previous: prev }))?.findings).toEqual(['old']);
		expect(previousOf(actions[0])).toBeNull();
		expect(previousOf(undefined)).toBeNull();
	});

	it('counts one row’s changed_since, tolerating a missing detail', () => {
		expect(changedCount(actions[0])).toBe(2);
		expect(changedCount(actions[2])).toBe(0);
		expect(changedCount({ step: 'discovery.x', status: 'ready' } as any)).toBe(0);
		expect(changedCount(undefined)).toBe(0);
	});

	it('counts what is new since the last run as the largest changed_since', () => {
		expect(newSinceLastRun(actions)).toBe(2);
		expect(newSinceLastRun([action('discovery.clarify_goals')])).toBe(0);
	});

	it('knows when it last ran and which stores were skipped', () => {
		expect(lastRunAt(actions)).toBe('2026-10-08T01:00:00Z');
		expect(lastRunAt([])).toBeNull();
		expect(skippedStores(actions)).toEqual(['finny refused the planner']);
	});

	it('is done only when all four are done', () => {
		expect(discoveryDone(actions)).toBe(false);
		expect(discoveryDone(actions.map((a) => ({ ...a, status: 'done' })))).toBe(true);
		expect(discoveryDone([])).toBe(false);
	});
});

describe('confidenceLabel', () => {
	it('buckets 0..1 into three words', () => {
		expect(confidenceLabel(0.9)).toBe('Well covered');
		expect(confidenceLabel(0.5)).toBe('Partly covered');
		expect(confidenceLabel(0.1)).toBe('Little evidence');
	});
});

describe('isAnalysing', () => {
	it('matches an onb_analyse job for THIS client only', () => {
		const snap = { running: [{ kind: 'onb_analyse', params: { client: '899317', step: 'discovery.clarify_goals' } }], last: {}, lastSuccessAt: {} } as any;
		expect(isAnalysing(snap, '899317')).toBe(true);
		expect(isAnalysing(snap, '1')).toBe(false);
		expect(isAnalysing({ running: [], last: {}, lastSuccessAt: {} } as any, '899317')).toBe(false);
	});

	it('matches on client alone, whatever step the job was started from (§9)', () => {
		const snap = { running: [{ kind: 'onb_analyse', params: { client: '7', step: 'discovery.risk_profile' } }], last: {}, lastSuccessAt: {} } as any;
		expect(isAnalysing(snap, '7')).toBe(true);
		const other = { running: [{ kind: 'onb_draft', params: { client: '7', step: 'enquiry.fsg' } }], last: {}, lastSuccessAt: {} } as any;
		expect(isAnalysing(other, '7')).toBe(false);
	});
});

describe('analyseOutcome', () => {
	const snap = (job: any) => ({ running: [], last: { onb_analyse: job }, lastSuccessAt: {} }) as any;
	const job = (status: string, error: string | null, client = '7') => ({ id: 'j', kind: 'onb_analyse', status, error, params: { client } });

	it('says why a run was skipped or failed', () => {
		expect(analyseOutcome(snap(job('skipped', 'nothing gathered yet')), '7')).toEqual({ kind: 'skipped', text: 'nothing gathered yet' });
		expect(analyseOutcome(snap(job('error', 'GOOGLE_API_KEY is not set')), '7')).toEqual({ kind: 'error', text: 'GOOGLE_API_KEY is not set' });
		expect(analyseOutcome(snap(job('error', null)), '7')).toEqual({ kind: 'error', text: 'The analysis failed.' });
	});

	it('surfaces a warning on a done run, and nothing on a clean one', () => {
		expect(analyseOutcome(snap(job('done', 'salem timed out')), '7')).toEqual({ kind: 'warning', text: 'salem timed out' });
		expect(analyseOutcome(snap(job('done', null)), '7')).toBeNull();
		expect(analyseOutcome(snap(job('cancelled', null)), '7')).toBeNull();
	});

	it('ignores another client’s run and a missing one', () => {
		expect(analyseOutcome(snap(job('skipped', 'x', '8')), '7')).toBeNull();
		expect(analyseOutcome({ running: [], last: {}, lastSuccessAt: {} } as any, '7')).toBeNull();
	});
});

describe('mergeNoteDrafts', () => {
	const actions = [
		action('discovery.clarify_goals', 'ready', { notes: 'saved A' }),
		action('discovery.collect_info', 'ready', { notes: 'saved B' }),
		action('discovery.define_scope', 'pending')
	];

	it('takes the saved notes, except where the planner is still typing', () => {
		const drafts = { 'discovery.clarify_goals': 'typing…', 'discovery.collect_info': 'stale' };
		expect(mergeNoteDrafts(drafts, actions, ['discovery.clarify_goals'])).toEqual({
			'discovery.clarify_goals': 'typing…',
			'discovery.collect_info': 'saved B',
			'discovery.define_scope': ''
		});
	});

	it('falls back to the saved note when a held step has no draft', () => {
		expect(mergeNoteDrafts({}, actions, ['discovery.clarify_goals'])['discovery.clarify_goals']).toBe('saved A');
	});
});

describe('notesToKeep', () => {
	it('keeps held steps and any step whose revision moved during the load', () => {
		expect(notesToKeep(['a'], { b: 1, c: 2 }, { b: 2, c: 2, d: 1 }).sort()).toEqual(['a', 'b', 'd']);
		expect(notesToKeep([], { b: 1 }, { b: 1 })).toEqual([]);
	});

	it('a save that finished during the load still beats the stale server note', () => {
		// The planner typed "new", its save landed while a tick's GET was out,
		// so nothing is pending or saving any more — but the GET read "old".
		const revAtStart = { 'discovery.clarify_goals': 1 };
		const revNow = { 'discovery.clarify_goals': 2 };
		const stale = [action('discovery.clarify_goals', 'ready', { notes: 'old' })];
		const keep = notesToKeep([], revAtStart, revNow);
		expect(mergeNoteDrafts({ 'discovery.clarify_goals': 'new' }, stale, keep)).toEqual({ 'discovery.clarify_goals': 'new' });
	});
});

it('stepId prefixes the stage', () => {
	expect(stepId('risk_profile')).toBe('discovery.risk_profile');
});
