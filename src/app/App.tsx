import React, { useCallback, useEffect, useRef, useState } from 'react';
import { EditorCanvas } from '../editor/canvas/EditorCanvas';
import { FakeImageEditProvider } from '../providers/fake/FakeImageEditProvider';
import { strictComposite } from '../imaging/composite/StrictCompositor';
import { applyOperation, createEmptyMask, MaskState, rasterizeMask, undo, redo } from '../editor/mask/maskModel';
import type { ImageEditRequest } from '../providers/contracts/types';
import styles from './App.module.css';

type EditMode = 'ai-mask' | 'strict-mask';

interface SourceImage {
  blob: Blob;
  width: number;
  height: number;
  objectUrl: string;
}

interface GenerateResult {
  providerResultUrl: string;
  finalResultUrl: string;
  finalResultBlob: Blob;
  elapsedMilliseconds: number;
}

const fakeProvider = new FakeImageEditProvider();

export function App(): React.ReactElement {
  const [sourceImage, setSourceImage] = useState<SourceImage | null>(null);
  const [maskState, setMaskState] = useState<MaskState>(createEmptyMask());
  const [maskOpacity, setMaskOpacity] = useState(0.5);
  const [prompt, setPrompt] = useState('');
  const [editMode, setEditMode] = useState<EditMode>('strict-mask');
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Cleanup object URLs
  useEffect(() => {
    return () => {
      if (sourceImage) URL.revokeObjectURL(sourceImage.objectUrl);
    };
  }, [sourceImage]);

  const loadImage = useCallback(async (blob: Blob) => {
    try {
      const bitmap = await createImageBitmap(blob);
      const url = URL.createObjectURL(blob);
      if (sourceImage) {
        URL.revokeObjectURL(sourceImage.objectUrl);
      }
      setSourceImage({ blob, width: bitmap.width, height: bitmap.height, objectUrl: url });
      setMaskState(createEmptyMask());
      setResult(null);
      setError(null);
      bitmap.close();
    } catch (e) {
      setError('Failed to load image. Please use PNG, JPEG, or WebP.');
    }
  }, [sourceImage]);

  // Paste handler
  useEffect(() => {
    const handler = async (e: ClipboardEvent) => {
      const item = e.clipboardData?.items[0];
      if (!item) return;
      if (!item.type.startsWith('image/')) return;
      const blob = item.getAsFile();
      if (blob) await loadImage(blob);
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [loadImage]);

  // Drag/drop handler
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      await loadImage(file);
    }
  }, [loadImage]);

  // File open
  const handleFileOpen = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) await loadImage(file);
    };
    input.click();
  }, [loadImage]);

  // Mask operations from canvas
  const handleMaskOperation = useCallback((op: Parameters<typeof applyOperation>[1]) => {
    setMaskState(prev => applyOperation(prev, op));
  }, []);

  const handleUndo = useCallback(() => setMaskState(prev => undo(prev)), []);
  const handleRedo = useCallback(() => setMaskState(prev => redo(prev)), []);

  // Generate
  const canGenerate = sourceImage !== null && prompt.trim().length > 0 && !isGenerating;

  const handleGenerate = useCallback(async () => {
    if (!sourceImage || !canGenerate) return;
    setIsGenerating(true);
    setError(null);
    setResult(null);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      // Rasterize mask
      const maskPixels = rasterizeMask(maskState, sourceImage.width, sourceImage.height);

      // Convert mask to RGBA PNG blob for provider
      const maskCanvas = new OffscreenCanvas(sourceImage.width, sourceImage.height);
      const maskCtx = maskCanvas.getContext('2d');
      if (!maskCtx) throw new Error('Cannot get mask canvas context');
      const maskImageData = new ImageData(
        new Uint8ClampedArray(maskPixels.length * 4),
        sourceImage.width,
        sourceImage.height
      );
      for (let i = 0; i < maskPixels.length; i++) {
        const v = maskPixels[i]!;
        maskImageData.data[i * 4] = v;
        maskImageData.data[i * 4 + 1] = v;
        maskImageData.data[i * 4 + 2] = v;
        maskImageData.data[i * 4 + 3] = 255;
      }
      maskCtx.putImageData(maskImageData, 0, 0);
      const maskBlob = await maskCanvas.convertToBlob({ type: 'image/png' });

      const request: ImageEditRequest = {
        sourceBlob: sourceImage.blob,
        maskBlob,
        referenceBlobs: [],
        prompt: prompt.trim(),
        modelId: 'fake-model',
        quality: 'standard',
      };

      const editResult = await fakeProvider.edit(request, { apiKey: '' }, abortController.signal);

      // If strict mask mode, composite
      let finalBlob: Blob;
      if (editMode === 'strict-mask') {
        // Decode original and result to pixel buffers
        const origBitmap = await createImageBitmap(sourceImage.blob);
        const genBitmap = await createImageBitmap(editResult.resultBlob);

        const compCanvas = new OffscreenCanvas(sourceImage.width, sourceImage.height);
        const compCtx = compCanvas.getContext('2d');
        if (!compCtx) throw new Error('Cannot get composite canvas context');

        compCtx.drawImage(origBitmap, 0, 0);
        const origPixels = compCtx.getImageData(0, 0, sourceImage.width, sourceImage.height);

        compCtx.clearRect(0, 0, sourceImage.width, sourceImage.height);
        compCtx.drawImage(genBitmap, 0, 0);
        const genPixels = compCtx.getImageData(0, 0, sourceImage.width, sourceImage.height);

        origBitmap.close();
        genBitmap.close();

        const composited = strictComposite(
          origPixels.data,
          genPixels.data,
          maskPixels,
          sourceImage.width,
          sourceImage.height
        );

        const finalImageData = new ImageData(composited as any, sourceImage.width, sourceImage.height);
        compCtx.putImageData(finalImageData, 0, 0);
        finalBlob = await compCanvas.convertToBlob({ type: 'image/png' });
      } else {
        finalBlob = editResult.resultBlob;
      }

      const providerUrl = URL.createObjectURL(editResult.resultBlob);
      const finalUrl = editMode === 'strict-mask'
        ? URL.createObjectURL(finalBlob)
        : providerUrl;

      setResult({
        providerResultUrl: providerUrl,
        finalResultUrl: finalUrl,
        finalResultBlob: finalBlob,
        elapsedMilliseconds: editResult.elapsedMilliseconds,
      });
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setError('Generation cancelled.');
      } else {
        setError(e instanceof Error ? e.message : 'Generation failed');
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  }, [sourceImage, maskState, prompt, editMode, canGenerate]);

  const handleCancel = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const handleDownload = useCallback(() => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result.finalResultUrl;
    a.download = 'vizalyx-result.png';
    a.click();
  }, [result]);

  return (
    <div className={styles.layout} onDragOver={handleDragOver} onDrop={handleDrop}>
      {/* Toolbar */}
      <header className={styles.toolbar}>
        <span className={styles.logo}>Vizalyx</span>
        <button onClick={handleFileOpen}>Open</button>
        <span className={styles.toolbarHint}>or Ctrl+V / drag & drop</span>
        <button onClick={handleUndo} disabled={maskState.historyIndex < 0}>Undo</button>
        <button onClick={handleRedo} disabled={maskState.historyIndex >= maskState.operations.length - 1}>Redo</button>
      </header>

      <div className={styles.body}>
        {/* Left panel */}
        <aside className={styles.leftPanel}>
          <div className={styles.panelSection}>
            <label className={styles.panelLabel}>Tools</label>
            <button className={styles.toolBtn}>Rect</button>
          </div>
          <div className={styles.panelSection}>
            <label className={styles.panelLabel}>Mask opacity</label>
            <input
              type="range" min={0} max={1} step={0.05}
              value={maskOpacity}
              onChange={e => setMaskOpacity(parseFloat(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>
        </aside>

        {/* Canvas */}
        <main className={styles.canvasArea}>
          {sourceImage ? (
            <EditorCanvas
              sourceUrl={sourceImage.objectUrl}
              sourceWidth={sourceImage.width}
              sourceHeight={sourceImage.height}
              maskState={maskState}
              maskOpacity={maskOpacity}
              onMaskOperation={handleMaskOperation}
            />
          ) : (
            <div className={styles.dropZone}>
              <p>Open, paste (Ctrl+V), or drag & drop an image to start</p>
            </div>
          )}
        </main>

        {/* Right panel */}
        <aside className={styles.rightPanel}>
          <div className={styles.panelSection}>
            <label className={styles.panelLabel}>Provider</label>
            <span>Fake (Dev/Test)</span>
          </div>

          <div className={styles.panelSection}>
            <label className={styles.panelLabel}>Prompt</label>
            <textarea
              className={styles.promptInput}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Describe the edit..."
              rows={4}
            />
          </div>

          <div className={styles.panelSection}>
            <label className={styles.panelLabel}>Mode</label>
            <label>
              <input
                type="radio" name="mode" value="ai-mask"
                checked={editMode === 'ai-mask'}
                onChange={() => setEditMode('ai-mask')}
              />{' '}AI Mask
            </label>
            <label>
              <input
                type="radio" name="mode" value="strict-mask"
                checked={editMode === 'strict-mask'}
                onChange={() => setEditMode('strict-mask')}
              />{' '}Strict Mask
            </label>
          </div>

          <div className={styles.panelSection}>
            <div className={styles.privacyNote}>
              Your API key (when configured) is used directly from the browser.
              Images are sent directly to the selected AI provider when Generate is clicked.
            </div>
          </div>

          {error && <div className={styles.errorMsg}>{error}</div>}

          {!isGenerating ? (
            <button
              className={styles.generateBtn}
              onClick={handleGenerate}
              disabled={!canGenerate}
            >
              Generate
            </button>
          ) : (
            <>
              <button className={styles.generateBtn} disabled>Generating...</button>
              <button className={styles.cancelBtn} onClick={handleCancel}>Cancel</button>
            </>
          )}

          {result && (
            <div className={styles.resultSection}>
              <div className={styles.resultMeta}>
                Done in {result.elapsedMilliseconds}ms
              </div>
              <div className={styles.resultImages}>
                <div>
                  <div className={styles.resultLabel}>Provider Result</div>
                  <img src={result.providerResultUrl} alt="Provider result" className={styles.resultImg} />
                </div>
                {editMode === 'strict-mask' && (
                  <div>
                    <div className={styles.resultLabel}>Final (Strict Mask)</div>
                    <img src={result.finalResultUrl} alt="Final result" className={styles.resultImg} />
                  </div>
                )}
              </div>
              <button className={styles.downloadBtn} onClick={handleDownload}>
                Download PNG
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
