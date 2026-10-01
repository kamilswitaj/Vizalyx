import type { RunEntity } from '../../persistence/indexeddb/database';

export interface CostSummaryMetric {
  readonly runCount: number;
  readonly paidRunCount: number;
  readonly totalUsd: number;
  readonly totalPln: number;
  readonly averageUsd: number;
  readonly averagePln: number;
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

export interface CostAggregationResult {
  readonly totalRuns: number;
  readonly paidRuns: number;
  readonly totalUsd: number;
  readonly totalPln: number;
  readonly averageUsd: number;
  readonly averagePln: number;
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
 * Aggregates token usage and costs from a collection of runs.
 * Excludes Fake Provider runs from paid cost totals.
 */
export function aggregateCosts(runs: readonly RunEntity[]): CostAggregationResult {
  let totalRuns = 0;
  let paidRuns = 0;
  let totalUsd = 0;
  let totalPln = 0;

  // Buckets for grouping
  const modelMap = new Map<string, { modelId: string; runs: RunEntity[] }>();
  const editModeMap = new Map<'ai-mask' | 'strict-mask', RunEntity[]>([
    ['ai-mask', []],
    ['strict-mask', []],
  ]);

  for (const run of runs) {
    totalRuns++;
    const isFake = run.providerId === 'fake' || run.modelId === 'fake-model';

    // Only paid runs contribute to cost totals
    if (!isFake && run.cost && typeof run.cost.usd === 'number') {
      paidRuns++;
      totalUsd += run.cost.usd;
      if (typeof run.cost.pln === 'number') {
        totalPln += run.cost.pln;
      }

      // Group by model
      const existing = modelMap.get(run.modelId) ?? { modelId: run.modelId, runs: [] };
      existing.runs.push(run);
      modelMap.set(run.modelId, existing);

      // Group by editMode
      const modeRuns = editModeMap.get(run.editMode) ?? [];
      modeRuns.push(run);
      editModeMap.set(run.editMode, modeRuns);
    }
  }

  const averageUsd = paidRuns > 0 ? totalUsd / paidRuns : 0;
  const averagePln = paidRuns > 0 ? totalPln / paidRuns : 0;

  // Format byModel
  const byModel: ModelCostSummary[] = Array.from(modelMap.values()).map(m => {
    let mUsd = 0;
    let mPln = 0;
    const qualityMap = new Map<string, RunEntity[]>();

    for (const r of m.runs) {
      if (r.cost) {
        mUsd += r.cost.usd;
        if (r.cost.pln) mPln += r.cost.pln;
      }
      const qRuns = qualityMap.get(r.quality) ?? [];
      qRuns.push(r);
      qualityMap.set(r.quality, qRuns);
    }

    const mPaidCount = m.runs.length;
    const byQuality: QualityCostSummary[] = Array.from(qualityMap.entries()).map(([q, qRuns]) => {
      let qUsd = 0;
      let qPln = 0;
      for (const qr of qRuns) {
        if (qr.cost) {
          qUsd += qr.cost.usd;
          if (qr.cost.pln) qPln += qr.cost.pln;
        }
      }
      return {
        quality: q,
        runCount: qRuns.length,
        paidRunCount: qRuns.length,
        totalUsd: qUsd,
        totalPln: qPln,
        averageUsd: qRuns.length > 0 ? qUsd / qRuns.length : 0,
        averagePln: qRuns.length > 0 ? qPln / qRuns.length : 0,
      };
    });

    // Sort qualities standard: low -> medium -> high -> xhigh -> max
    const qualityOrder = ['low', 'medium', 'high', 'xhigh', 'max'];
    byQuality.sort((a, b) => {
      const idxA = qualityOrder.indexOf(a.quality);
      const idxB = qualityOrder.indexOf(b.quality);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      return a.quality.localeCompare(b.quality);
    });

    return {
      modelId: m.modelId,
      displayName: getModelDisplayName(m.modelId),
      runCount: m.runs.length,
      paidRunCount: mPaidCount,
      totalUsd: mUsd,
      totalPln: mPln,
      averageUsd: mPaidCount > 0 ? mUsd / mPaidCount : 0,
      averagePln: mPaidCount > 0 ? mPln / mPaidCount : 0,
      byQuality,
    };
  });

  // Format byEditMode
  const byEditMode: EditModeCostSummary[] = (['strict-mask', 'ai-mask'] as const).map(mode => {
    const mRuns = editModeMap.get(mode) ?? [];
    let mUsd = 0;
    let mPln = 0;
    for (const r of mRuns) {
      if (r.cost) {
        mUsd += r.cost.usd;
        if (r.cost.pln) mPln += r.cost.pln;
      }
    }
    const mCount = mRuns.length;
    return {
      editMode: mode,
      displayName: mode === 'strict-mask' ? 'Strict Mask' : 'AI Mask',
      runCount: mCount,
      paidRunCount: mCount,
      totalUsd: mUsd,
      totalPln: mPln,
      averageUsd: mCount > 0 ? mUsd / mCount : 0,
      averagePln: mCount > 0 ? mPln / mCount : 0,
    };
  });

  return {
    totalRuns,
    paidRuns,
    totalUsd,
    totalPln,
    averageUsd,
    averagePln,
    byModel,
    byEditMode,
  };
}
