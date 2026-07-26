import { describe, it, expect, vi } from 'vitest';
import { runClientDeepSync, resyncSection, SECTION_OPS } from './deepSync';
import { XplanNotLoggedInError, XplanCancelledError } from './index';

const okDeps = () => {
	const calls: string[] = [];
	const saves: unknown[] = [];
	return {
		calls,
		saves,
		deps: {
			run: vi.fn(async (opId: string) => {
				calls.push(opId);
				return { from: opId };
			}),
			save: vi.fn(async (d: unknown) => {
				saves.push(JSON.parse(JSON.stringify(d)));
			})
		}
	};
};

describe('runClientDeepSync', () => {
	it('runs the six sections sequentially, in order, saving after each', async () => {
		const { calls, saves, deps } = okDeps();
		const detail = await runClientDeepSync('111111', 'Testperson, Alex', deps);
		expect(calls).toEqual(SECTION_OPS.map(([, opId]) => opId));
		expect(calls).toEqual([
			'client.contact',
			'client.financials',
			'client.insurance',
			'client.tasks',
			'client.notes',
			'client.super'
		]);
		expect(saves).toHaveLength(6); // one save per section
		expect(Object.keys(detail.sections)).toHaveLength(6);
		expect(detail.sections.contact?.status).toBe('ok');
		expect(detail.sections.super?.status).toBe('ok');
	});
	it('marks a failed section error and CONTINUES with the rest', async () => {
		const { deps } = okDeps();
		(deps.run as ReturnType<typeof vi.fn>).mockImplementation(async (opId: string) => {
			if (opId === 'client.insurance') throw new Error('parse failed');
			return {};
		});
		const detail = await runClientDeepSync('111111', 'Testperson, Alex', deps);
		expect(detail.sections.insurance?.status).toBe('error');
		expect(detail.sections.notes?.status).toBe('ok'); // later section still ran
	});
	it('ABORTS the whole sequence on NOT_LOGGED_IN', async () => {
		const { calls, deps } = okDeps();
		(deps.run as ReturnType<typeof vi.fn>).mockImplementation(async (opId: string) => {
			calls.push(opId);
			if (opId === 'client.financials') throw new XplanNotLoggedInError();
			return {};
		});
		await expect(runClientDeepSync('111111', 'T', deps)).rejects.toBeInstanceOf(XplanNotLoggedInError);
		expect(calls).toEqual(['client.contact', 'client.financials']); // nothing after
	});
	it('STOPS cleanly on cancel — returns the partial detail, does not throw or record the cancelled section', async () => {
		const { calls, deps } = okDeps();
		(deps.run as ReturnType<typeof vi.fn>).mockImplementation(async (opId: string) => {
			calls.push(opId);
			if (opId === 'client.insurance') throw new XplanCancelledError();
			return {};
		});
		const detail = await runClientDeepSync('1', 'T', deps); // resolves, not rejects
		expect(calls).toEqual(['client.contact', 'client.financials', 'client.insurance']); // stopped here
		expect(detail.sections.contact?.status).toBe('ok');
		expect(detail.sections.insurance).toBeUndefined(); // cancel not recorded as data
		expect(detail.sections.tasks).toBeUndefined(); // nothing after
	});
	it('does not start any section when the signal is already aborted', async () => {
		const { calls, deps } = okDeps();
		const ac = new AbortController();
		ac.abort();
		const detail = await runClientDeepSync('1', 'T', deps, undefined, ac.signal);
		expect(calls).toEqual([]);
		expect(Object.keys(detail.sections)).toHaveLength(0);
	});
	it('refuses to run two syncs at once', async () => {
		const { deps } = okDeps();
		let release!: () => void;
		(deps.run as ReturnType<typeof vi.fn>).mockImplementation(
			() => new Promise((r) => (release = () => r({})))
		);
		const first = runClientDeepSync('1', 'A', deps);
		await expect(runClientDeepSync('2', 'B', okDeps().deps)).rejects.toThrow(/already running/i);
		for (let i = 0; i < SECTION_OPS.length; i++) {
			release();
			await new Promise((r) => setTimeout(r, 0));
		}
		await first;
	});
});

describe('resyncSection', () => {
	it('re-runs one section and merges into the existing detail', async () => {
		const { calls, deps } = okDeps();
		const base = { clientId: '1', name: 'A', sections: {} };
		const out = await resyncSection(base, 'insurance', deps);
		expect(calls).toEqual(['client.insurance']);
		expect(out.sections.insurance?.status).toBe('ok');
	});
});
