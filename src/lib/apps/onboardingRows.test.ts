import { describe, it, expect } from 'vitest';
import { rowsFor } from './onboardingRows';

describe('rowsFor', () => {
	// STAGES (Plan 3's mirror of shared-contracts/types/onboarding.ts) is
	// {stage: readonly step-id[]}; the pages need a title and a line each.
	it('gives the four Stage 3 rows in process-map order, titled', () => {
		expect(rowsFor('data_entry')).toEqual([
			{ step: 'data_entry.update_xplan', id: 'update_xplan', title: 'Update XPLAN', detail: 'Upload the client’s documents; the agent proposes what to enter. You approve every item.' },
			{ step: 'data_entry.gather_missing', id: 'gather_missing', title: 'Gather missing information', detail: 'Chase what the fact find and documents did not cover.' },
			{ step: 'data_entry.product_research', id: 'product_research', title: 'Product research', detail: 'Existing products, fees and features — super, insurance, investments.' },
			{ step: 'data_entry.strategy_modelling', id: 'strategy_modelling', title: 'Strategy modelling', detail: 'Model the options before the strategy meeting.' }
		]);
	});

	it('gives the four Stage 2 rows', () => {
		expect(rowsFor('discovery').map((r) => [r.step, r.title])).toEqual([
			['discovery.clarify_goals', 'Clarify Goals'],
			['discovery.collect_info', 'Collect Information'],
			['discovery.define_scope', 'Define Scope'],
			['discovery.risk_profile', 'Risk Profiling']
		]);
	});

	it('titles a step without copy from its id', () => {
		expect(rowsFor('strategy')[1]).toEqual({ step: 'strategy.paraplanning', id: 'paraplanning', title: 'Paraplanning', detail: '' });
	});
});
