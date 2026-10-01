import type { RunEntity } from '../../persistence/indexeddb/database';

export interface CostSummaryMetric {
  readonly totalRuns: number;
  readonly paidRuns: number;
  readonly freeDevRuns: number;
  readonly unknownCostRuns: number;
  readonly plnPricedRuns: number;
  readonly totalUsd: number;
  readonly totalPln: number;
  readonly averageUsd: number;
  readonly averagePln: number;
  readonly missingPlnRuns: number;
  readonly isPlnCoverageComplete: boolean;

  // Convenience aliases for backward compatibility
  readonly runCount: number;
  readonly paidRunCount: number;
}

export interface QualityCostSummary extends CostSummaryMetric {
  readonly quality: string;
}

export interface ModelCostSummary extends CostSummaryMetric {
  readonly modelId: string;
  readonly displayName: string;
  readonly byQuality: QualityCostSummary[];
}

export interface EditModeCostSummary extends CostSummaryMetric {
  readonly editMode: 'ai-mask' | 'strict-mask';
  readonly displayName: string;
}

export interface CostAggregationResult extends CostSummaryMetric {
  readonly byModel: ModelCostSummary[];
  readonly byEditMode: EditModeCostSummary[];
}

function getModelDisplayName(modelId: string): string {
  if (modelId === 'gpt-image-2.5-sunburst') return 'Sunburst';
  if (modelId === 'gpt-image-2.5-flare') return 'Flare';
  if (modelId === 'fake-model') return 'Fake (Dev/Test)';
  return modelId;
}

/**
 * Computes accounting metrics for a set of runs adhering to Vizalyx rules:
 * - Fake provider runs = freeDevRuns.
 * - Non-fake runs with USD cost = paidRuns.
 * - Non-fake runs without cost = unknownCostRuns (NOT free/dev).
 * - Runs with PLN conversion = plnPricedRuns.
 * - averagePln divides ONLY by plnPricedRuns.
 */
export function computeCostSummaryMetric(runs: readonly RunEntity[]): CostSummaryMetric {
  let totalRuns = 0;
  let paidRuns = 0;
  let freeDevRuns = 0;
  let unknownCostRuns = 0;
  let plnPricedRuns = 0;
  let totalUsd = 0;
  let totalPln = 0;

  for (const run of runs) {
    totalRuns++;
    const isFake = run.providerId === 'fake' || run.modelId === 'fake-model';
    if (isFake) {
      freeDevRuns++;
      continue;
    }

    const hasUsd = run.cost != null && typeof run.cost.usd === 'number' && !isNaN(run.cost.usd);
    if (!hasUsd) {
      unknownCostRuns++;
      continue;
    }

    paidRuns++;
    totalUsd += run.cost!.usd;

    const hasPln = typeof run.cost!.pln === 'number' && !isNaN(run.cost!.pln);
    if (hasPln) {
      plnPricedRuns++;
      totalPln += run.cost!.pln!;
    }
  }

  const averageUsd = paidRuns > 0 ? totalUsd / paidRuns : 0;
  const averagePln = plnPricedRuns > 0 ? totalPln / plnPricedRuns : 0;
  const missingPlnRuns = paidRuns - plnPricedRuns;
  const isPlnCoverageComplete = paidRuns > 0 && missingPlnRuns === 0;

  return {
    totalRuns,
    paidRuns,
    freeDevRuns,
    unknownCostRuns,
    plnPricedRuns,
    totalUsd,
    totalPln,
    averageUsd,
    averagePln,
    missingPlnRuns,
    isPlnCoverageComplete,
    runCount: totalRuns,
    paidRunCount: paidRuns,
  };
}

/**
 * Aggregates token usage and costs from a collection of runs.
 * Excludes Fake Provider runs from paid cost totals and tracks explicit coverage.
 */
export function aggregateCosts(runs: readonly RunEntity[]): CostAggregationResult {
  const overall = computeCostSummaryMetric(runs);

  // Group non-fake runs by model
  const modelMap = new Map<string, RunEntity[]>();
  for (const run of runs) {
    const isFake = run.providerId === 'fake' || run.modelId === 'fake-model';
    if (!isFake) {
      const list = modelMap.get(run.modelId) ?? [];
      list.push(run);
      modelMap.set(run.modelId, list);
    }
  }

  const byModel: ModelCostSummary[] = Array.from(modelMap.entries()).map(([modelId, mRuns]) => {
    const modelMetric = computeCostSummaryMetric(mRuns);

    // Group by quality within model
    const qualityMap = new Map<string, RunEntity[]>();
    for (const r of mRuns) {
      const qList = qualityMap.get(r.quality) ?? [];
      qList.push(r);
      qualityMap.set(r.quality, qList);
    }

    const byQuality: QualityCostSummary[] = Array.from(qualityMap.entries()).map(
      ([quality, qRuns]) => {
        const qMetric = computeCostSummaryMetric(qRuns);
        return {
          ...qMetric,
          quality,
        };
      }
    );

    const qualityOrder = ['low', 'medium', 'high', 'xhigh', 'max'];
    byQuality.sort((a, b) => {
      const idxA = qualityOrder.indexOf(a.quality);
      const idxB = qualityOrder.indexOf(b.quality);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      return a.quality.localeCompare(b.quality);
    });

    return {
      ...modelMetric,
      modelId,
      displayName: getModelDisplayName(modelId),
      byQuality,
    };
  });

  // Group by edit mode (strict-mask vs ai-mask)
  const byEditMode: EditModeCostSummary[] = (['strict-mask', 'ai-mask'] as const).map(mode => {
    const modeRuns = runs.filter(r => r.editMode === mode);
    const modeMetric = computeCostSummaryMetric(modeRuns);
    return {
      ...modeMetric,
      editMode: mode,
      displayName: mode === 'strict-mask' ? 'Strict Mask' : 'AI Mask',
    };
  });

  return {
    ...overall,
    byModel,
    byEditMode,
  };
}
