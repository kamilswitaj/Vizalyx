import { describe, it, expect } from 'vitest';
import { aggregateCosts } from '../../src/accounting/aggregation/costAggregation';
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
  it('returns zeroes for empty run list', () => {
    const summary = aggregateCosts([]);
    expect(summary.totalRuns).toBe(0);
    expect(summary.paidRuns).toBe(0);
    expect(summary.totalUsd).toBe(0);
    expect(summary.totalPln).toBe(0);
    expect(summary.averageUsd).toBe(0);
    expect(summary.averagePln).toBe(0);
    expect(summary.byModel).toHaveLength(0);
    expect(summary.byEditMode).toHaveLength(2);
  });

  it('aggregates paid OpenAI runs correctly', () => {
    const runs: RunEntity[] = [
      createMockRun({
        modelId: 'gpt-image-2.5-sunburst',
        quality: 'high',
        editMode: 'strict-mask',
        cost: {
          usd: 0.08,
          pln: 0.32,
          calculation: 'actual',
        },
      }),
      createMockRun({
        modelId: 'gpt-image-2.5-sunburst',
        quality: 'medium',
        editMode: 'ai-mask',
        cost: {
          usd: 0.04,
          pln: 0.16,
          calculation: 'actual',
        },
      }),
      createMockRun({
        modelId: 'gpt-image-2.5-flare',
        quality: 'high',
        editMode: 'strict-mask',
        cost: {
          usd: 0.12,
          pln: 0.48,
          calculation: 'actual',
        },
      }),
    ];

    const summary = aggregateCosts(runs);

    expect(summary.totalRuns).toBe(3);
    expect(summary.paidRuns).toBe(3);
    expect(summary.totalUsd).toBeCloseTo(0.24, 6);
    expect(summary.totalPln).toBeCloseTo(0.96, 6);
    expect(summary.averageUsd).toBeCloseTo(0.08, 6);
    expect(summary.averagePln).toBeCloseTo(0.32, 6);

    // Check byModel grouping
    expect(summary.byModel).toHaveLength(2);
    const sunburst = summary.byModel.find(m => m.modelId === 'gpt-image-2.5-sunburst');
    expect(sunburst).toBeDefined();
    expect(sunburst?.runCount).toBe(2);
    expect(sunburst?.totalUsd).toBeCloseTo(0.12, 6);
    expect(sunburst?.byQuality).toHaveLength(2);

    const flare = summary.byModel.find(m => m.modelId === 'gpt-image-2.5-flare');
    expect(flare).toBeDefined();
    expect(flare?.runCount).toBe(1);
    expect(flare?.totalUsd).toBeCloseTo(0.12, 6);

    // Check byEditMode grouping
    const strictMode = summary.byEditMode.find(m => m.editMode === 'strict-mask');
    expect(strictMode?.runCount).toBe(2);
    expect(strictMode?.totalUsd).toBeCloseTo(0.20, 6);

    const aiMode = summary.byEditMode.find(m => m.editMode === 'ai-mask');
    expect(aiMode?.runCount).toBe(1);
    expect(aiMode?.totalUsd).toBeCloseTo(0.04, 6);
  });

  it('excludes fake provider and free/dev runs from paid totals but counts in totalRuns', () => {
    const runs: RunEntity[] = [
      createMockRun({
        providerId: 'fake',
        modelId: 'fake-model',
        quality: 'standard',
        cost: undefined,
      }),
      createMockRun({
        providerId: 'fake',
        modelId: 'fake-model',
        cost: {
          usd: 0,
          calculation: 'actual',
        },
      }),
      createMockRun({
        providerId: 'openai',
        modelId: 'gpt-image-2.5-sunburst',
        quality: 'high',
        cost: {
          usd: 0.05,
          pln: 0.20,
          calculation: 'actual',
        },
      }),
    ];

    const summary = aggregateCosts(runs);

    expect(summary.totalRuns).toBe(3);
    expect(summary.paidRuns).toBe(1);
    expect(summary.totalUsd).toBeCloseTo(0.05, 6);
    expect(summary.totalPln).toBeCloseTo(0.20, 6);
    expect(summary.averageUsd).toBeCloseTo(0.05, 6);
    expect(summary.averagePln).toBeCloseTo(0.20, 6);
  });

  it('handles runs with missing or undefined cost gracefully', () => {
    const runs: RunEntity[] = [
      createMockRun({
        providerId: 'openai',
        modelId: 'gpt-image-2.5-sunburst',
        cost: undefined,
      }),
    ];

    const summary = aggregateCosts(runs);
    expect(summary.totalRuns).toBe(1);
    expect(summary.paidRuns).toBe(0);
    expect(summary.totalUsd).toBe(0);
    expect(summary.totalPln).toBe(0);
  });
});
