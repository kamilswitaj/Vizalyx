import { describe, it, expect } from 'vitest';
import {
  aggregateCosts,
  computeCostSummaryMetric,
} from '../../src/accounting/aggregation/costAggregation';
import type { RunEntity } from '../../src/persistence/indexeddb/database';

function createMockRun(overrides: Partial<RunEntity>): RunEntity {
  return {
    id: `run-${Math.random().toString(36).slice(2, 8)}`,
    projectId: 'proj-1',
    createdAt: Date.now(),
    providerId: 'openai',
    modelId: 'gpt-image-2.5-sunburst',
    quality: 'high',
    prompt: 'paint red door',
    editMode: 'strict-mask',
    featherPixels: 4,
    maskAssetId: 'mask-1',
    providerResultAssetId: 'res-1',
    finalResultAssetId: 'final-1',
    referenceAssetIds: [],
    elapsedMilliseconds: 15000,
    status: 'completed',
    ...overrides,
  };
}

describe('costAggregation', () => {
  it('returns zeroes and clean empty counters for empty run list', () => {
    const summary = aggregateCosts([]);
    expect(summary.totalRuns).toBe(0);
    expect(summary.paidRuns).toBe(0);
    expect(summary.freeDevRuns).toBe(0);
    expect(summary.unknownCostRuns).toBe(0);
    expect(summary.plnPricedRuns).toBe(0);
    expect(summary.missingPlnRuns).toBe(0);
    expect(summary.isPlnCoverageComplete).toBe(false);
    expect(summary.totalUsd).toBe(0);
    expect(summary.totalPln).toBe(0);
    expect(summary.averageUsd).toBe(0);
    expect(summary.averagePln).toBe(0);
    expect(summary.byModel).toHaveLength(0);
    expect(summary.byEditMode).toHaveLength(2);
  });

  describe('mixed cases', () => {
    it('case 1: all PLN available (complete coverage)', () => {
      const runs: RunEntity[] = [
        createMockRun({
          modelId: 'gpt-image-2.5-sunburst',
          quality: 'high',
          editMode: 'strict-mask',
          cost: {
            usd: 0.1,
            pln: 0.4,
            calculation: 'actual',
          },
        }),
        createMockRun({
          modelId: 'gpt-image-2.5-sunburst',
          quality: 'high',
          editMode: 'strict-mask',
          cost: {
            usd: 0.2,
            pln: 0.8,
            calculation: 'actual',
          },
        }),
      ];

      const summary = aggregateCosts(runs);
      expect(summary.totalRuns).toBe(2);
      expect(summary.paidRuns).toBe(2);
      expect(summary.plnPricedRuns).toBe(2);
      expect(summary.missingPlnRuns).toBe(0);
      expect(summary.isPlnCoverageComplete).toBe(true);
      expect(summary.totalUsd).toBeCloseTo(0.3, 6);
      expect(summary.totalPln).toBeCloseTo(1.2, 6);
      expect(summary.averageUsd).toBeCloseTo(0.15, 6);
      expect(summary.averagePln).toBeCloseTo(0.6, 6);
    });

    it('case 2: some PLN unavailable (partial coverage: 10 paid runs, 8 with PLN, 2 without)', () => {
      const runs: RunEntity[] = [];

      // 8 runs with USD and PLN ($0.10 and 0.40 zł each)
      for (let i = 0; i < 8; i++) {
        runs.push(
          createMockRun({
            modelId: 'gpt-image-2.5-sunburst',
            quality: 'high',
            editMode: 'strict-mask',
            cost: {
              usd: 0.1,
              pln: 0.4,
              calculation: 'actual',
            },
          })
        );
      }

      // 2 runs with USD only ($0.20 each, no PLN conversion)
      for (let i = 0; i < 2; i++) {
        runs.push(
          createMockRun({
            modelId: 'gpt-image-2.5-sunburst',
            quality: 'high',
            editMode: 'strict-mask',
            cost: {
              usd: 0.2,
              pln: undefined,
              calculation: 'actual',
            },
          })
        );
      }

      const summary = aggregateCosts(runs);

      // Verify overall
      expect(summary.totalRuns).toBe(10);
      expect(summary.paidRuns).toBe(10);
      expect(summary.plnPricedRuns).toBe(8);
      expect(summary.missingPlnRuns).toBe(2);
      expect(summary.isPlnCoverageComplete).toBe(false);

      // USD totals all 10 runs: 8 * 0.10 + 2 * 0.20 = 1.20 USD
      expect(summary.totalUsd).toBeCloseTo(1.2, 6);
      expect(summary.averageUsd).toBeCloseTo(0.12, 6); // 1.20 / 10

      // PLN totals only the 8 runs: 8 * 0.40 = 3.20 zł
      expect(summary.totalPln).toBeCloseTo(3.2, 6);
      // CRITICAL: averagePln divides ONLY by plnPricedRuns (8), NOT by all paidRuns (10)!
      expect(summary.averagePln).toBeCloseTo(0.4, 6); // 3.20 / 8 = 0.40 zł

      // Check that byModel carries the same partial coverage metrics
      const sunburst = summary.byModel.find(m => m.modelId === 'gpt-image-2.5-sunburst');
      expect(sunburst).toBeDefined();
      expect(sunburst?.paidRuns).toBe(10);
      expect(sunburst?.plnPricedRuns).toBe(8);
      expect(sunburst?.missingPlnRuns).toBe(2);
      expect(sunburst?.isPlnCoverageComplete).toBe(false);
      expect(sunburst?.averagePln).toBeCloseTo(0.4, 6);

      // Check quality
      const high = sunburst?.byQuality.find(q => q.quality === 'high');
      expect(high?.paidRuns).toBe(10);
      expect(high?.plnPricedRuns).toBe(8);
      expect(high?.missingPlnRuns).toBe(2);
      expect(high?.isPlnCoverageComplete).toBe(false);

      // Check byEditMode
      const strict = summary.byEditMode.find(m => m.editMode === 'strict-mask');
      expect(strict?.paidRuns).toBe(10);
      expect(strict?.plnPricedRuns).toBe(8);
      expect(strict?.missingPlnRuns).toBe(2);
      expect(strict?.isPlnCoverageComplete).toBe(false);
    });

    it('case 3: all PLN unavailable', () => {
      const runs: RunEntity[] = [
        createMockRun({
          cost: { usd: 0.05, calculation: 'actual' },
        }),
        createMockRun({
          cost: { usd: 0.15, calculation: 'actual' },
        }),
      ];

      const summary = aggregateCosts(runs);
      expect(summary.totalRuns).toBe(2);
      expect(summary.paidRuns).toBe(2);
      expect(summary.plnPricedRuns).toBe(0);
      expect(summary.missingPlnRuns).toBe(2);
      expect(summary.isPlnCoverageComplete).toBe(false);
      expect(summary.totalUsd).toBeCloseTo(0.2, 6);
      expect(summary.totalPln).toBe(0);
      expect(summary.averageUsd).toBeCloseTo(0.1, 6);
      expect(summary.averagePln).toBe(0); // Safely 0, does not divide by zero
    });

    it('case 4: Fake + paid + unknown-cost runs', () => {
      const runs: RunEntity[] = [
        // 2 Fake runs
        createMockRun({
          providerId: 'fake',
          modelId: 'fake-model',
          cost: undefined,
        }),
        createMockRun({
          providerId: 'fake',
          modelId: 'fake-model',
          cost: { usd: 0, calculation: 'actual' },
        }),

        // 2 Paid OpenAI runs
        createMockRun({
          providerId: 'openai',
          modelId: 'gpt-image-2.5-sunburst',
          cost: { usd: 0.08, pln: 0.32, calculation: 'actual' },
        }),
        createMockRun({
          providerId: 'openai',
          modelId: 'gpt-image-2.5-flare',
          cost: { usd: 0.12, pln: 0.48, calculation: 'actual' },
        }),

        // 3 Unknown-cost OpenAI runs (e.g. historical runs or failed runs without cost)
        createMockRun({
          providerId: 'openai',
          modelId: 'gpt-image-2.5-sunburst',
          cost: undefined,
        }),
        createMockRun({
          providerId: 'openai',
          modelId: 'gpt-image-2.5-sunburst',
          cost: undefined,
        }),
        createMockRun({
          providerId: 'openai',
          modelId: 'gpt-image-2.5-flare',
          cost: undefined,
        }),
      ];

      const summary = aggregateCosts(runs);

      // Verify exact categorization
      expect(summary.totalRuns).toBe(7);
      expect(summary.freeDevRuns).toBe(2);
      expect(summary.paidRuns).toBe(2);
      // Non-fake runs without cost are unknownCostRuns, NOT freeDevRuns
      expect(summary.unknownCostRuns).toBe(3);
      expect(summary.plnPricedRuns).toBe(2);
      expect(summary.isPlnCoverageComplete).toBe(true); // for the 2 paid runs, both had PLN

      expect(summary.totalUsd).toBeCloseTo(0.2, 6);
      expect(summary.totalPln).toBeCloseTo(0.8, 6);
      expect(summary.averageUsd).toBeCloseTo(0.1, 6);
      expect(summary.averagePln).toBeCloseTo(0.4, 6);

      // Verify model breakdown correctly associates unknownCostRuns
      const sunburst = summary.byModel.find(m => m.modelId === 'gpt-image-2.5-sunburst');
      expect(sunburst).toBeDefined();
      expect(sunburst?.totalRuns).toBe(3); // 1 paid + 2 unknown
      expect(sunburst?.paidRuns).toBe(1);
      expect(sunburst?.unknownCostRuns).toBe(2);
      expect(sunburst?.freeDevRuns).toBe(0);

      const flare = summary.byModel.find(m => m.modelId === 'gpt-image-2.5-flare');
      expect(flare).toBeDefined();
      expect(flare?.totalRuns).toBe(2); // 1 paid + 1 unknown
      expect(flare?.paidRuns).toBe(1);
      expect(flare?.unknownCostRuns).toBe(1);

      // Fake model should NOT be in byModel
      expect(summary.byModel.find(m => m.modelId === 'fake-model')).toBeUndefined();
    });
  });

  describe('computeCostSummaryMetric helper', () => {
    it('accurately computes metrics on arbitrary subsets', () => {
      const subset: RunEntity[] = [
        createMockRun({ cost: { usd: 0.05, pln: 0.2, calculation: 'actual' } }),
        createMockRun({ cost: { usd: 0.05, calculation: 'actual' } }),
      ];

      const metric = computeCostSummaryMetric(subset);
      expect(metric.totalRuns).toBe(2);
      expect(metric.paidRuns).toBe(2);
      expect(metric.plnPricedRuns).toBe(1);
      expect(metric.missingPlnRuns).toBe(1);
      expect(metric.isPlnCoverageComplete).toBe(false);
      expect(metric.averagePln).toBeCloseTo(0.2, 6);
      expect(metric.averageUsd).toBeCloseTo(0.05, 6);
    });
  });
});
