import React, { useCallback, useEffect, useRef, useState } from 'react';
import { EditorCanvas } from '../editor/canvas/EditorCanvas';
import { FakeImageEditProvider } from '../providers/fake/FakeImageEditProvider';
import { strictComposite } from '../imaging/composite/StrictCompositor';
import {
  applyOperation,
  createEmptyMask,
  MaskState,
  rasterizeMask,
  undo,
  redo,
} from '../editor/mask/maskModel';
import type { ImageEditRequest, RasterMask } from '../providers/contracts/types';
import styles from './App.module.css';

type EditMode = 'ai-mask' | 'strict-mask';

interface SourceImage {
  blob: Blob;
  width: number;
  height: number;
  objectUrl: string;
}

interface GenerateResult {
  editMode: EditMode;
  providerResultUrl: string;
  finalResultUrl: string;
  finalResultBlob: Blob;
  elapsedMilliseconds: number;
}

const fakeProvider = new FakeImageEditProvider();

function revokeResultUrls(res: GenerateResult | null) {
  if (!res) return;
  if (res.providerResultUrl) {
    URL.revokeObjectURL(res.providerResultUrl);
  }
  if (res.finalResultUrl && res.finalResultUrl !== res.providerResultUrl) {
    URL.revokeObjectURL(res.finalResultUrl);
  }
}

function revokeSourceImageUrl(source: SourceImage | null) {
  if (!source) return;
  if (source.objectUrl) {
    URL.revokeObjectURL(source.objectUrl);
  }
}

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
  const generationIdRef = useRef(0);

  // Store refs for unmount cleanup
  const sourceImageRef = useRef<SourceImage | null>(null);
  sourceImageRef.current = sourceImage;
  const resultRef = useRef<GenerateResult | null>(null);
  resultRef.current = result;

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      revokeSourceImageUrl(sourceImageRef.current);
      revokeResultUrls(resultRef.current);
    };
  }, []);

  const loadImage = useCallback(async (blob: Blob) => {
    // Cancel in-flight generation and invalidate generation ID
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    generationIdRef.current++;
    setIsGenerating(false);

    try {
      const bitmap = await createImageBitmap(blob);
      const url = URL.createObjectURL(blob);

      setSourceImage(prev => {
        revokeSourceImageUrl(prev);
        return { blob, width: bitmap.width, height: bitmap.height, objectUrl: url };
      });

      setResult(prev => {
        revokeResultUrls(prev);
        return null;
      });

      setMaskState(createEmptyMask());
      setError(null);
      bitmap.close();
    } catch (err) {
      console.error('loadImage error:', err);
      setError('Failed to load image. Please use PNG, JPEG, or WebP.');
    }
  }, []);

  // Paste handler: find first image item in clipboard
  useEffect(() => {
    const handler = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item && item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            await loadImage(blob);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [loadImage]);

  // Drag/drop handler
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const files = e.dataTransfer.files;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file && file.type.startsWith('image/')) {
          await loadImage(file);
          break;
        }
      }
    },
    [loadImage]
  );

  const fileInputRef = useRef<HTMLInputElement>(null);

  // File open
  const handleFileOpen = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        await loadImage(file);
      }
      e.target.value = '';
    },
    [loadImage]
  );

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

    // Clear and revoke previous result
    setResult(prev => {
      revokeResultUrls(prev);
      return null;
    });

    const currentGenId = ++generationIdRef.current;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const currentMode = editMode;

    try {
      // Rasterize mask only when required for generation/compositing
      const maskPixels = rasterizeMask(maskState, sourceImage.width, sourceImage.height);
      const mask: RasterMask = {
        width: sourceImage.width,
        height: sourceImage.height,
        data: maskPixels,
      };

      const request: ImageEditRequest = {
        sourceBlob: sourceImage.blob,
        mask,
        referenceBlobs: [],
        prompt: prompt.trim(),
        modelId: 'fake-model',
        quality: 'standard',
      };

      const editResult = await fakeProvider.edit(request, { apiKey: '' }, abortController.signal);

      // Invalidate if source image changed or cancelled
      if (generationIdRef.current !== currentGenId) {
        return;
      }

      let finalBlob: Blob;
      if (currentMode === 'strict-mask') {
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

        const finalImageData = compCtx.createImageData(sourceImage.width, sourceImage.height);
        finalImageData.data.set(composited);
        compCtx.putImageData(finalImageData, 0, 0);
        finalBlob = await compCanvas.convertToBlob({ type: 'image/png' });
      } else {
        finalBlob = editResult.resultBlob;
      }

      if (generationIdRef.current !== currentGenId) {
        return;
      }

      const providerUrl = URL.createObjectURL(editResult.resultBlob);
      const finalUrl =
        currentMode === 'strict-mask' ? URL.createObjectURL(finalBlob) : providerUrl;

      setResult({
        editMode: currentMode,
        providerResultUrl: providerUrl,
        finalResultUrl: finalUrl,
        finalResultBlob: finalBlob,
        elapsedMilliseconds: editResult.elapsedMilliseconds,
      });
    } catch (e: unknown) {
      if (generationIdRef.current !== currentGenId) {
        return;
      }
      if (e instanceof DOMException && e.name === 'AbortError') {
        setError('Generation cancelled.');
      } else {
        setError(e instanceof Error ? e.message : 'Generation failed');
      }
    } finally {
      if (generationIdRef.current === currentGenId) {
        setIsGenerating(false);
        abortControllerRef.current = null;
      }
    }
  }, [sourceImage, canGenerate, editMode, maskState, prompt]);

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
        <input
          ref={fileInputRef}
          type="file"
          data-testid="file-input"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: 'none' }}
          onChange={handleFileInputChange}
        />
        <span className={styles.toolbarHint}>or Ctrl+V / drag & drop</span>
        <button onClick={handleUndo} disabled={maskState.historyIndex < 0}>
          Undo
        </button>
        <button
          onClick={handleRedo}
          disabled={maskState.historyIndex >= maskState.operations.length - 1}
        >
          Redo
        </button>
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
              type="range"
              min={0}
              max={1}
              step={0.05}
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
                type="radio"
                name="mode"
                value="ai-mask"
                checked={editMode === 'ai-mask'}
                onChange={() => setEditMode('ai-mask')}
              />{' '}
              AI Mask
            </label>
            <label>
              <input
                type="radio"
                name="mode"
                value="strict-mask"
                checked={editMode === 'strict-mask'}
                onChange={() => setEditMode('strict-mask')}
              />{' '}
              Strict Mask
            </label>
          </div>

          <div className={styles.panelSection}>
            <div className={styles.privacyNote}>
              Your API key (when configured) is used directly from the browser. Images are sent
              directly to the selected AI provider when Generate is clicked.
            </div>
          </div>

          {error && <div className={styles.errorMsg}>{error}</div>}

          {!isGenerating ? (
            <button className={styles.generateBtn} onClick={handleGenerate} disabled={!canGenerate}>
              Generate
            </button>
          ) : (
            <>
              <button className={styles.generateBtn} disabled>
                Generating...
              </button>
              <button className={styles.cancelBtn} onClick={handleCancel}>
                Cancel
              </button>
            </>
          )}

          {result && (
            <div className={styles.resultSection}>
              <div className={styles.resultMeta}>
                Done in {result.elapsedMilliseconds}ms ({result.editMode === 'strict-mask' ? 'Strict Mask' : 'AI Mask'})
              </div>
              <div className={styles.resultImages}>
                <div>
                  <div className={styles.resultLabel}>Provider Result</div>
                  <img
                    src={result.providerResultUrl}
                    alt="Provider result"
                    className={styles.resultImg}
                  />
                </div>
                {result.editMode === 'strict-mask' && (
                  <div>
                    <div className={styles.resultLabel}>Final (Strict Mask)</div>
                    <img
                      src={result.finalResultUrl}
                      alt="Final result"
                      className={styles.resultImg}
                    />
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
