import React, { useEffect, useMemo, useState } from 'react';
import { db, type RunEntity } from '../../persistence/indexeddb/database';
import { aggregateCosts } from '../aggregation/costAggregation';
import {
  formatPln,
  formatUsd,
  ESTIMATED_PLN_TOOLTIP,
} from '../formatting/costFormatting';
import styles from './CostSummaryModal.module.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentProjectRuns: readonly RunEntity[];
  currentProjectName?: string;
}

export function CostSummaryModal({
  isOpen,
  onClose,
  currentProjectRuns,
  currentProjectName,
}: Props): React.ReactElement | null {
  const [scope, setScope] = useState<'current' | 'all'>('current');
  const [allRuns, setAllRuns] = useState<RunEntity[]>([]);

  useEffect(() => {
    if (isOpen) {
      void (async () => {
        try {
          const runs = await db.runs.toArray();
          setAllRuns(runs);
        } catch (e) {
          console.warn('Could not load all runs for cost summary:', e);
        }
      })();
    }
  }, [isOpen]);

  const activeRuns = useMemo(() => {
    return scope === 'current' ? currentProjectRuns : allRuns;
  }, [scope, currentProjectRuns, allRuns]);

  const summary = useMemo(() => {
    return aggregateCosts(activeRuns);
  }, [activeRuns]);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.title}>Costs & Token Usage</div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close cost summary">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {/* Scope switch */}
          <div className={styles.scopeSwitch}>
            <button
              className={scope === 'current' ? styles.scopeBtnActive : styles.scopeBtn}
              onClick={() => setScope('current')}
            >
              Current Project {currentProjectName ? `(${currentProjectName.slice(0, 14)})` : ''}
            </button>
            <button
              className={scope === 'all' ? styles.scopeBtnActive : styles.scopeBtn}
              onClick={() => setScope('all')}
            >
              All Local Projects
            </button>
          </div>

          {summary.paidRuns === 0 && summary.totalRuns === 0 ? (
            <div className={styles.emptyState}>No generation runs recorded in this scope.</div>
          ) : summary.paidRuns === 0 ? (
            <div className={styles.emptyState}>
              {summary.freeDevRuns > 0 && `${summary.freeDevRuns} local/dev run(s) recorded. `}
              {summary.unknownCostRuns > 0 && `${summary.unknownCostRuns} run(s) without cost metadata. `}
              No paid generations with recorded cost in this scope.
            </div>
          ) : (
            <>
              {/* Total Card */}
              <div className={styles.totalCard}>
                <div className={styles.sectionTitle}>Total Estimated Spend</div>
                <div className={styles.totalPrimary}>
                  <div className={styles.totalPln} title={ESTIMATED_PLN_TOOLTIP}>
                    {formatPln(summary.totalPln)}
                    {!summary.isPlnCoverageComplete && summary.paidRuns > 0 && (
                      <span className={styles.plnCoverage}>
                        {' '}({summary.plnPricedRuns}/{summary.paidRuns} runs)
                      </span>
                    )}
                  </div>
                  <div className={styles.totalUsd}>{formatUsd(summary.totalUsd)}</div>
                </div>
                {!summary.isPlnCoverageComplete && summary.paidRuns > 0 && (
                  <div className={styles.plnWarning}>
                    {summary.missingPlnRuns} {summary.missingPlnRuns === 1 ? 'run does' : 'runs do'} not have PLN conversion
                  </div>
                )}
                <div className={styles.totalMeta}>
                  <span>
                    {summary.paidRuns} paid generation{summary.paidRuns === 1 ? '' : 's'}
                    {summary.freeDevRuns > 0 ? ` · ${summary.freeDevRuns} free/dev` : ''}
                    {summary.unknownCostRuns > 0 ? ` · ${summary.unknownCostRuns} unknown cost` : ''}
                  </span>
                  <span>
                    Avg: {summary.plnPricedRuns > 0 ? formatPln(summary.averagePln) : '— zł'} / run ({formatUsd(summary.averageUsd)})
                  </span>
                </div>
              </div>

              {/* By Model */}
              {summary.byModel.length > 0 && (
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>By Model & Quality</div>
                  {summary.byModel.map(model => (
                    <div key={model.modelId} className={styles.modelCard}>
                      <div className={styles.modelHeader}>
                        <span>{model.displayName}</span>
                        <span className={styles.modelStats}>
                          {formatPln(model.totalPln)}
                          {!model.isPlnCoverageComplete && model.paidRuns > 0 && (
                            <span className={styles.plnCoverage}>
                              {' '}({model.plnPricedRuns}/{model.paidRuns})
                            </span>
                          )}
                          {' '}({formatUsd(model.totalUsd)})
                        </span>
                      </div>
                      {!model.isPlnCoverageComplete && model.paidRuns > 0 && (
                        <div className={styles.modelPlnWarning}>
                          {model.missingPlnRuns} {model.missingPlnRuns === 1 ? 'run does' : 'runs do'} not have PLN conversion
                        </div>
                      )}
                      <div className={styles.qualityList}>
                        {model.byQuality.map(q => (
                          <div key={q.quality} className={styles.qualityRow}>
                            <span className={styles.qualityName}>{q.quality}</span>
                            <span>
                              {q.paidRuns} paid run{q.paidRuns === 1 ? '' : 's'}
                              {q.unknownCostRuns > 0 ? ` · ${q.unknownCostRuns} unknown` : ''}
                            </span>
                            <span className={styles.qualityCost}>
                              {formatPln(q.totalPln)}
                              {!q.isPlnCoverageComplete && q.paidRuns > 0 && (
                                <span className={styles.plnCoverage}>
                                  {' '}({q.plnPricedRuns}/{q.paidRuns})
                                </span>
                              )}
                              {' '}
                              <span style={{ color: '#777', fontSize: '0.75rem' }}>
                                ({formatUsd(q.totalUsd)})
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* By Edit Mode */}
              {summary.byEditMode.some(m => m.paidRuns > 0 || m.totalRuns > 0) && (
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>By Edit Mode</div>
                  <div className={styles.editModeGrid}>
                    {summary.byEditMode.map(m => (
                      <div key={m.editMode} className={styles.editModeCard}>
                        <div className={styles.editModeName}>{m.displayName}</div>
                        <div className={styles.editModeCost}>
                          {formatPln(m.totalPln)}
                          {!m.isPlnCoverageComplete && m.paidRuns > 0 && (
                            <span className={styles.editModePlnCoverage}>
                              {' '}({m.plnPricedRuns}/{m.paidRuns} runs)
                            </span>
                          )}
                        </div>
                        {!m.isPlnCoverageComplete && m.paidRuns > 0 && (
                          <div className={styles.editModePlnWarning}>
                            {m.missingPlnRuns} {m.missingPlnRuns === 1 ? 'run' : 'runs'} without PLN
                          </div>
                        )}
                        <div className={styles.editModeMeta}>
                          {m.paidRuns} paid run{m.paidRuns === 1 ? '' : 's'} · {formatUsd(m.totalUsd)}
                          {m.unknownCostRuns > 0 ? ` · ${m.unknownCostRuns} unknown` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Explanatory note */}
              <div className={styles.note}>
                {ESTIMATED_PLN_TOOLTIP}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
