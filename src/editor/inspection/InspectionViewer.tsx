import React, { useState } from 'react';
import styles from './InspectionViewer.module.css';

export type InspectionTab = 'final' | 'provider' | 'original' | 'compare';

interface InspectionViewerProps {
  sourceUrl: string;
  providerResultUrl: string;
  finalResultUrl: string;
  editMode: 'ai-mask' | 'strict-mask';
  elapsedMilliseconds: number;
  modelId: string;
  onDownloadFinal: () => void;
  onDownloadProvider?: () => void;
  onSwitchToEditor: () => void;
}

export function InspectionViewer({
  sourceUrl,
  providerResultUrl,
  finalResultUrl,
  editMode,
  elapsedMilliseconds,
  modelId,
  onDownloadFinal,
  onDownloadProvider,
  onSwitchToEditor,
}: InspectionViewerProps): React.ReactElement {
  const [activeTab, setActiveTab] = useState<InspectionTab>('final');
  const [sliderPos, setSliderPos] = useState(50); // percentage 0-100 for before/after comparison

  return (
    <div className={styles.container}>
      {/* Top Bar Navigation */}
      <div className={styles.topBar}>
        <div className={styles.tabGroup}>
          <button
            className={activeTab === 'final' ? styles.tabBtnActive : styles.tabBtn}
            onClick={() => setActiveTab('final')}
          >
            Final Result
          </button>

          {editMode === 'strict-mask' && (
            <button
              className={activeTab === 'provider' ? styles.tabBtnActive : styles.tabBtn}
              onClick={() => setActiveTab('provider')}
            >
              Provider Result
            </button>
          )}

          <button
            className={activeTab === 'original' ? styles.tabBtnActive : styles.tabBtn}
            onClick={() => setActiveTab('original')}
          >
            Original
          </button>

          <button
            className={activeTab === 'compare' ? styles.tabBtnActive : styles.tabBtn}
            onClick={() => setActiveTab('compare')}
          >
            Before / After
          </button>
        </div>

        <div className={styles.controls}>
          <span style={{ fontSize: '0.8rem', color: '#888' }}>
            {modelId} · {elapsedMilliseconds}ms
          </span>

          <button className={styles.actionBtn} onClick={onSwitchToEditor}>
            Edit Mask
          </button>

          {editMode === 'strict-mask' && onDownloadProvider && activeTab === 'provider' && (
            <button className={styles.downloadBtn} onClick={onDownloadProvider}>
              Download Provider PNG
            </button>
          )}

          <button className={styles.downloadBtn} onClick={onDownloadFinal}>
            Download Final PNG
          </button>
        </div>
      </div>

      {/* Main Viewport */}
      <div className={styles.viewport}>
        {activeTab === 'final' && (
          <div className={styles.imageWrapper}>
            <img src={finalResultUrl} alt="Final result" className={styles.singleImg} />
          </div>
        )}

        {activeTab === 'provider' && (
          <div className={styles.imageWrapper}>
            <img src={providerResultUrl} alt="Provider result" className={styles.singleImg} />
          </div>
        )}

        {activeTab === 'original' && (
          <div className={styles.imageWrapper}>
            <img src={sourceUrl} alt="Original source" className={styles.singleImg} />
          </div>
        )}

        {activeTab === 'compare' && (
          <div className={styles.compareWrapper}>
            {/* Background is Final Result */}
            <img src={finalResultUrl} alt="Final result" className={styles.compareBaseImg} />

            {/* Clipped overlay is Original Image */}
            <div
              className={styles.compareOverlay}
              style={{ width: `${sliderPos}%` }}
            >
              <img
                src={sourceUrl}
                alt="Original source"
                className={styles.compareOverlayImg}
                style={{ width: '100%', minWidth: '100%', maxWidth: 'none' }}
              />
            </div>

            {/* Interactive Slider Bar */}
            <div className={styles.sliderContainer}>
              <span className={styles.sliderLabel}>Original</span>
              <input
                type="range"
                min={0}
                max={100}
                value={sliderPos}
                onChange={e => setSliderPos(parseInt(e.target.value, 10))}
                className={styles.rangeSlider}
              />
              <span className={styles.sliderLabel}>Result</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
