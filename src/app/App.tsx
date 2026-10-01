import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorCanvas } from '../editor/canvas/EditorCanvas';
import { FakeImageEditProvider } from '../providers/fake/FakeImageEditProvider';
import { OpenAIImageEditProvider } from '../providers/openai/OpenAIImageEditProvider';
import { ProviderRegistry } from '../providers/registry';
import { SettingsModal } from '../settings/SettingsModal';
import { ProjectListModal } from '../projects/ProjectListModal';
import { InspectionViewer } from '../editor/inspection/InspectionViewer';
import { strictComposite } from '../imaging/composite/StrictCompositor';
import { featherMask } from '../imaging/masks/featherMask';
import { rasterMaskToBlob, blobToRasterMaskOperation } from '../imaging/masks/maskExport';
import {
  createProject,
  loadProject,
  loadLatestProject,
  saveRun,
  getAssetBlob,
} from '../persistence/indexeddb/projectRepository';
import type { ProjectEntity, RunEntity } from '../persistence/indexeddb/database';
import {
  applyOperation,
  clearMask,
  createEmptyMask,
  MaskState,
  rasterizeMask,
  undo,
  redo,
} from '../editor/mask/maskModel';
import type { ImageEditRequest, RasterMask } from '../providers/contracts/types';
import type { EditorTool } from '../editor/tools/editorTools';
import styles from './App.module.css';

type EditMode = 'ai-mask' | 'strict-mask';

interface SourceImage {
  blob: Blob;
  width: number;
  height: number;
  objectUrl: string;
}

interface ReferenceImage {
  id: string;
  blob: Blob;
  objectUrl: string;
  assetId?: string;
}

interface GenerateResult {
  editMode: EditMode;
  providerId: string;
  modelId: string;
  quality: string;
  featherPixels?: number;
  providerResultUrl: string;
  finalResultUrl: string;
  finalResultBlob: Blob;
  elapsedMilliseconds: number;
}

// Global provider registry instance
const registry = new ProviderRegistry();
const fakeProvider = new FakeImageEditProvider();
const openAiProvider = new OpenAIImageEditProvider();
registry.register(fakeProvider);
registry.register(openAiProvider);

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

function revokeReferenceImageUrls(refs: ReferenceImage[]) {
  refs.forEach(r => URL.revokeObjectURL(r.objectUrl));
}


export function App(): React.ReactElement {
  const [sourceImage, setSourceImage] = useState<SourceImage | null>(null);
  const [maskState, setMaskState] = useState<MaskState>(createEmptyMask());
  const [maskOpacity, setMaskOpacity] = useState(0.5);
  const [activeTool, setActiveTool] = useState<EditorTool>('rectangle');
  const [brushRadius, setBrushRadius] = useState(20);
  const [featherPixels, setFeatherPixels] = useState(8);
  const [fitTrigger, setFitTrigger] = useState(0);

  // BYOK in-memory state only
  const [openAiKey, setOpenAiKey] = useState<string>('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Projects & History state
  const [currentProject, setCurrentProject] = useState<ProjectEntity | null>(null);
  const [runs, setRuns] = useState<RunEntity[]>([]);
  const [isProjectsOpen, setIsProjectsOpen] = useState(false);
  const currentProjectRef = useRef<ProjectEntity | null>(null);
  currentProjectRef.current = currentProject;

  // Provider & Model configuration
  const descriptors = useMemo(() => registry.getDescriptors(), []);
  const [selectedProviderId, setSelectedProviderId] = useState<string>('fake');
  const selectedProvider = useMemo(
    () => registry.get(selectedProviderId) ?? fakeProvider,
    [selectedProviderId]
  );
  const providerDescriptor = useMemo(
    () => selectedProvider.getDescriptor(),
    [selectedProvider]
  );

  const [selectedModelId, setSelectedModelId] = useState<string>(
    () => providerDescriptor.models[0]?.id ?? 'fake-model'
  );

  // Sync selected model when provider changes
  useEffect(() => {
    const firstModel = providerDescriptor.models[0]?.id;
    if (firstModel) setSelectedModelId(firstModel);
  }, [providerDescriptor]);

  const selectedModel = useMemo(
    () => providerDescriptor.models.find(m => m.id === selectedModelId) ?? providerDescriptor.models[0],
    [providerDescriptor, selectedModelId]
  );

  const [selectedQuality, setSelectedQuality] = useState<string>(
    () => selectedModel?.supportedQualities[0] ?? 'standard'
  );

  // Sync selected quality when model changes
  useEffect(() => {
    const firstQuality = selectedModel?.supportedQualities[0];
    if (firstQuality) setSelectedQuality(firstQuality);
  }, [selectedModel]);

  const [prompt, setPrompt] = useState('');
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const refFileInputRef = useRef<HTMLInputElement>(null);
  const referenceImagesRef = useRef<ReferenceImage[]>([]);
  referenceImagesRef.current = referenceImages;

  const [editMode, setEditMode] = useState<EditMode>('strict-mask');
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [centerView, setCenterView] = useState<'editor' | 'inspect'>('editor');
  const [error, setError] = useState<string | null>(null);


  const abortControllerRef = useRef<AbortController | null>(null);
  const generationIdRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      revokeReferenceImageUrls(referenceImagesRef.current);
    };
  }, []);


  const loadImage = useCallback(async (blob: Blob, existingProjectId?: string) => {
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
      setCenterView('editor');
      setError(null);

      // Create new project if not loading an existing one
      if (!existingProjectId) {
        try {
          const loaded = await createProject(
            `Project ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
            blob,
            bitmap.width,
            bitmap.height
          );
          setCurrentProject(loaded.project);
          setRuns([]);
        } catch (dbErr) {
          console.warn('Failed to save new project to IndexedDB:', dbErr);
        }
      }

      bitmap.close();
    } catch (err) {
      console.error('loadImage error:', err);
      setError('Failed to load image. Please use PNG, JPEG, or WebP.');
    }
  }, []);

  // Restore latest project on mount
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const latest = await loadLatestProject();
        if (mounted && latest) {
          setCurrentProject(latest.project);
          setRuns(latest.runs);
          await loadImage(latest.sourceAsset.blob, latest.project.id);
        }
      } catch (err) {
        console.warn('Could not load latest project from IndexedDB:', err);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [loadImage]);

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
  const handleClear = useCallback(() => setMaskState(prev => clearMask(prev)), []);
  const handleFitViewport = useCallback(() => setFitTrigger(prev => prev + 1), []);

  // Reference images handlers
  const handleAddReferenceImages = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const maxRefs = 4;
    setReferenceImages(prev => {
      const remaining = maxRefs - prev.length;
      if (remaining <= 0) return prev;
      const added: ReferenceImage[] = [];
      for (let i = 0; i < Math.min(files.length, remaining); i++) {
        const file = files[i];
        if (
          file &&
          (file.type.startsWith('image/') ||
            /\.(png|jpe?g|webp)$/i.test(file.name) ||
            !file.type)
        ) {
          added.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${i}`,
            blob: file,
            objectUrl: URL.createObjectURL(file),
          });
        }
      }
      return [...prev, ...added];
    });
  }, []);


  const handleRemoveReferenceImage = useCallback((id: string) => {
    setReferenceImages(prev => {
      const target = prev.find(r => r.id === id);
      if (target) URL.revokeObjectURL(target.objectUrl);
      return prev.filter(r => r.id !== id);
    });
  }, []);

  // Generate validation
  const needsApiKey = selectedProviderId === 'openai' && !openAiKey.trim();
  const canGenerate =
    sourceImage !== null && prompt.trim().length > 0 && !isGenerating && !needsApiKey;

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
    const currentFeather = featherPixels;
    const currentProvider = selectedProvider;
    const currentModelId = selectedModelId;
    const currentQuality = selectedQuality;

    try {
      // Rasterize mask only when required for generation/compositing
      const rawMaskPixels = rasterizeMask(maskState, sourceImage.width, sourceImage.height);
      const mask: RasterMask = {
        width: sourceImage.width,
        height: sourceImage.height,
        data: rawMaskPixels,
      };

      const request: ImageEditRequest = {
        sourceBlob: sourceImage.blob,
        mask,
        referenceBlobs: referenceImages.map(r => r.blob),
        prompt: prompt.trim(),
        modelId: currentModelId,
        quality: currentQuality,
      };


      const credentials = { apiKey: selectedProviderId === 'openai' ? openAiKey : '' };
      const editResult = await currentProvider.edit(request, credentials, abortController.signal);

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
        compCtx.imageSmoothingEnabled = true;
        compCtx.imageSmoothingQuality = 'high';
        compCtx.drawImage(genBitmap, 0, 0, sourceImage.width, sourceImage.height);
        const genPixels = compCtx.getImageData(0, 0, sourceImage.width, sourceImage.height);

        origBitmap.close();
        genBitmap.close();

        // Apply feathering to the strict mask if configured
        const effectiveMask =
          currentFeather > 0
            ? featherMask(rawMaskPixels, sourceImage.width, sourceImage.height, currentFeather)
            : rawMaskPixels;

        const composited = strictComposite(
          origPixels.data,
          genPixels.data,
          effectiveMask,
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
        providerId: selectedProviderId,
        modelId: currentModelId,
        quality: currentQuality,
        featherPixels: currentFeather,
        providerResultUrl: providerUrl,
        finalResultUrl: finalUrl,
        finalResultBlob: finalBlob,
        elapsedMilliseconds: editResult.elapsedMilliseconds,
      });
      setCenterView('inspect');

      // Persist run in IndexedDB
      const activeProj = currentProjectRef.current;
      if (activeProj) {
        try {
          const maskPng = await rasterMaskToBlob(mask);
          const references = referenceImages.map(r => ({
            assetId: r.assetId,
            blob: r.blob,
          }));

          const savedRun = await saveRun({
            projectId: activeProj.id,
            providerId: selectedProviderId,
            modelId: currentModelId,
            quality: currentQuality,
            prompt: prompt.trim(),
            editMode: currentMode,
            featherPixels: currentFeather,
            maskBlob: maskPng,
            providerResultBlob: editResult.resultBlob,
            finalResultBlob: finalBlob,
            references,
            elapsedMilliseconds: editResult.elapsedMilliseconds,
            providerRequestId: editResult.providerRequestId,
          });
          setRuns(prev => [savedRun, ...prev]);

          // Update referenceImages state with assigned assetIds
          setReferenceImages(prev =>
            prev.map((ref, idx) => ({
              ...ref,
              assetId: savedRun.referenceAssetIds[idx] ?? ref.assetId,
            }))
          );
        } catch (saveErr) {
          console.warn('Failed to save run to IndexedDB:', saveErr);
        }
      }
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
  }, [
    sourceImage,
    canGenerate,
    editMode,
    featherPixels,
    selectedProvider,
    selectedProviderId,
    selectedModelId,
    selectedQuality,
    openAiKey,
    maskState,
    prompt,
    referenceImages,
  ]);

  const handleCancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    generationIdRef.current++;
    setIsGenerating(false);
    setError('Generation cancelled.');
  }, []);

  const handleDownload = useCallback(() => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result.finalResultUrl;
    a.download = 'vizalyx-result.png';
    a.click();
  }, [result]);

  const handleDownloadProvider = useCallback(() => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result.providerResultUrl;
    a.download = 'vizalyx-provider-result.png';
    a.click();
  }, [result]);

  // Project management handlers
  const handleSelectProject = useCallback(
    async (projectId: string) => {
      try {
        const loaded = await loadProject(projectId);
        if (loaded) {
          setCurrentProject(loaded.project);
          setRuns(loaded.runs);
          await loadImage(loaded.sourceAsset.blob, loaded.project.id);
        }
      } catch (err) {
        console.error('Failed to switch project:', err);
      }
    },
    [loadImage]
  );

  const handleNewProject = useCallback(() => {
    setCurrentProject(null);
    setRuns([]);
    setReferenceImages(prev => {
      revokeReferenceImageUrls(prev);
      return [];
    });
    setSourceImage(prev => {
      revokeSourceImageUrl(prev);
      return null;
    });
    setMaskState(createEmptyMask());
    setResult(prev => {
      revokeResultUrls(prev);
      return null;
    });
    setCenterView('editor');
    setError(null);
  }, []);

  // Run history handlers
  const handleRestoreRunParams = useCallback((run: RunEntity) => {
    setPrompt(run.prompt);
    setSelectedProviderId(run.providerId);
    setSelectedModelId(run.modelId);
    setSelectedQuality(run.quality);
    setEditMode(run.editMode);
    setFeatherPixels(run.featherPixels);

    // Restore historical mask
    if (run.maskAssetId) {
      void (async () => {
        try {
          const maskBlob = await getAssetBlob(run.maskAssetId);
          if (maskBlob) {
            const rasterOp = await blobToRasterMaskOperation(maskBlob);
            setMaskState({
              operations: [rasterOp],
              historyIndex: 0,
            });
          }
        } catch (maskErr) {
          console.error('Failed to restore run mask:', maskErr);
        }
      })();
    }

    if (run.referenceAssetIds && run.referenceAssetIds.length > 0) {
      void (async () => {
        const loadedRefs: ReferenceImage[] = [];
        for (const assetId of run.referenceAssetIds) {
          const blob = await getAssetBlob(assetId);
          if (blob) {
            loadedRefs.push({
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              blob,
              objectUrl: URL.createObjectURL(blob),
              assetId,
            });
          }
        }
        setReferenceImages(prev => {
          revokeReferenceImageUrls(prev);
          return loadedRefs;
        });
      })();
    } else {
      setReferenceImages(prev => {
        revokeReferenceImageUrls(prev);
        return [];
      });
    }

    setCenterView('editor');
  }, []);

  const handleViewRunResult = useCallback(async (run: RunEntity) => {
    try {
      const pBlob = await getAssetBlob(run.providerResultAssetId);
      const fBlob = await getAssetBlob(run.finalResultAssetId);
      if (!pBlob || !fBlob) return;

      const pUrl = URL.createObjectURL(pBlob);
      const fUrl = run.editMode === 'strict-mask' ? URL.createObjectURL(fBlob) : pUrl;

      setResult(prev => {
        revokeResultUrls(prev);
        return {
          editMode: run.editMode,
          providerId: run.providerId,
          modelId: run.modelId,
          quality: run.quality,
          featherPixels: run.featherPixels,
          providerResultUrl: pUrl,
          finalResultUrl: fUrl,
          finalResultBlob: fBlob,
          elapsedMilliseconds: run.elapsedMilliseconds,
        };
      });
      setCenterView('inspect');
    } catch (err) {
      console.error('Failed to load run result assets:', err);
    }
  }, []);


  return (
    <div className={styles.layout} onDragOver={handleDragOver} onDrop={handleDrop}>
      {/* Toolbar */}
      <header className={styles.toolbar}>
        <span className={styles.logo}>Vizalyx</span>
        <button onClick={handleNewProject} title="Start new project / clear workspace">
          New
        </button>
        <button onClick={handleFileOpen}>Open</button>
        <input
          ref={fileInputRef}
          type="file"
          data-testid="file-input"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: 'none' }}
          onChange={handleFileInputChange}
        />
        <button onClick={() => setIsProjectsOpen(true)}>
          Projects {currentProject ? `(${currentProject.name.slice(0, 16)})` : ''}
        </button>
        <span className={styles.toolbarHint}>or Ctrl+V / drag & drop</span>
        <button onClick={handleFitViewport} disabled={!sourceImage}>
          Fit
        </button>
        <button onClick={handleUndo} disabled={maskState.historyIndex < 0 || isGenerating}>
          Undo
        </button>
        <button
          onClick={handleRedo}
          disabled={maskState.historyIndex >= maskState.operations.length - 1 || isGenerating}
        >
          Redo
        </button>
        <button onClick={() => setIsSettingsOpen(true)}>
          Settings {openAiKey ? '●' : ''}
        </button>
        {result && (
          <div style={{ display: 'flex', gap: '4px', marginLeft: '6px' }}>
            <button
              style={{
                background: centerView === 'editor' ? '#3355cc' : '#3a3a3a',
                color: '#fff',
                fontWeight: centerView === 'editor' ? 600 : 'normal',
              }}
              onClick={() => setCenterView('editor')}
            >
              Mask Editor
            </button>
            <button
              style={{
                background: centerView === 'inspect' ? '#3355cc' : '#3a3a3a',
                color: '#fff',
                fontWeight: centerView === 'inspect' ? 600 : 'normal',
              }}
              onClick={() => setCenterView('inspect')}
            >
              Inspect Result
            </button>
          </div>
        )}
      </header>

      <div className={styles.body}>
        {/* Left panel: Tools */}
        <aside className={styles.leftPanel}>
          <div className={styles.panelSection}>
            <label className={styles.panelLabel}>Tools</label>
            <div className={styles.toolGroup}>
              <button
                className={activeTool === 'rectangle' ? styles.toolBtnActive : styles.toolBtn}
                onClick={() => setActiveTool('rectangle')}
              >
                Rectangle
              </button>
              <button
                className={activeTool === 'brush' ? styles.toolBtnActive : styles.toolBtn}
                onClick={() => setActiveTool('brush')}
              >
                Brush
              </button>
              <button
                className={activeTool === 'eraser' ? styles.toolBtnActive : styles.toolBtn}
                onClick={() => setActiveTool('eraser')}
              >
                Eraser
              </button>
              <button
                className={activeTool === 'pan' ? styles.toolBtnActive : styles.toolBtn}
                onClick={() => setActiveTool('pan')}
              >
                Pan
              </button>
            </div>
          </div>

          {(activeTool === 'brush' || activeTool === 'eraser') && (
            <div className={styles.panelSection}>
              <label className={styles.panelLabel}>
                Size <span>{brushRadius}px</span>
              </label>
              <input
                type="range"
                min={2}
                max={100}
                step={1}
                value={brushRadius}
                onChange={e => setBrushRadius(parseInt(e.target.value, 10))}
                style={{ width: '100%' }}
              />
            </div>
          )}

          <div className={styles.panelSection}>
            <button
              className={styles.clearBtn}
              onClick={handleClear}
              disabled={maskState.historyIndex < 0 || isGenerating}
            >
              Clear Mask
            </button>
          </div>

          <div className={styles.panelSection}>
            <label className={styles.panelLabel}>
              Opacity <span>{Math.round(maskOpacity * 100)}%</span>
            </label>
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

        {/* Canvas or Inspection Area */}
        <main className={styles.canvasArea}>
          {centerView === 'inspect' && result && sourceImage ? (
            <InspectionViewer
              sourceUrl={sourceImage.objectUrl}
              providerResultUrl={result.providerResultUrl}
              finalResultUrl={result.finalResultUrl}
              editMode={result.editMode}
              elapsedMilliseconds={result.elapsedMilliseconds}
              modelId={result.modelId}
              onDownloadFinal={handleDownload}
              onDownloadProvider={handleDownloadProvider}
              onSwitchToEditor={() => setCenterView('editor')}
            />
          ) : sourceImage ? (
            <EditorCanvas
              sourceUrl={sourceImage.objectUrl}
              sourceWidth={sourceImage.width}
              sourceHeight={sourceImage.height}
              maskState={maskState}
              maskOpacity={maskOpacity}
              activeTool={activeTool}
              brushRadius={brushRadius}
              fitTrigger={fitTrigger}
              onMaskOperation={handleMaskOperation}
              isDrawingDisabled={isGenerating}
            />
          ) : (
            <div className={styles.dropZone}>
              <p>Open, paste (Ctrl+V), or drag & drop an image to start</p>
            </div>
          )}
        </main>


        {/* Right panel: Edit & Generate & History */}
        <aside className={styles.rightPanel}>
          <div className={styles.panelSection}>
            <label className={styles.panelLabel}>Provider</label>
            <select
              className={styles.selectInput}
              value={selectedProviderId}
              onChange={e => setSelectedProviderId(e.target.value)}
            >
              {descriptors.map(d => (
                <option key={d.id} value={d.id}>
                  {d.displayName}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.panelSection}>
            <label className={styles.panelLabel}>Model</label>
            <select
              className={styles.selectInput}
              value={selectedModelId}
              onChange={e => setSelectedModelId(e.target.value)}
            >
              {providerDescriptor.models.map(m => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.panelSection}>
            <label className={styles.panelLabel}>Quality</label>
            <select
              className={styles.selectInput}
              value={selectedQuality}
              onChange={e => setSelectedQuality(e.target.value)}
            >
              {selectedModel?.supportedQualities.map(q => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
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

          {/* Reference Images */}
          {selectedModel?.supportsReferenceImages && (
            <div className={styles.panelSection}>
              <label className={styles.panelLabel}>
                Reference Images <span>({referenceImages.length}/4)</span>
              </label>
              {referenceImages.length > 0 && (
                <div className={styles.referenceList}>
                  {referenceImages.map(ref => (
                    <div key={ref.id} className={styles.referenceItem}>
                      <img src={ref.objectUrl} alt="Reference" className={styles.referenceThumb} />
                      <button
                        className={styles.referenceRemoveBtn}
                        onClick={() => handleRemoveReferenceImage(ref.id)}
                        title="Remove reference image"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {referenceImages.length < 4 && (
                <>
                  <input
                    ref={refFileInputRef}
                    type="file"
                    multiple
                    data-testid="ref-file-input"
                    accept="image/png,image/jpeg,image/webp"
                    style={{ display: 'none' }}
                    onChange={e => {
                      handleAddReferenceImages(e.target.files);
                      e.target.value = '';
                    }}
                  />
                  <button
                    className={styles.addRefBtn}
                    onClick={() => refFileInputRef.current?.click()}
                  >
                    + Add Reference Image
                  </button>
                </>
              )}
            </div>
          )}


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

          {editMode === 'strict-mask' && (
            <div className={styles.panelSection}>
              <label className={styles.panelLabel}>
                Feather <span>{featherPixels}px</span>
              </label>
              <input
                type="range"
                min={0}
                max={50}
                step={1}
                value={featherPixels}
                onChange={e => setFeatherPixels(parseInt(e.target.value, 10))}
                style={{ width: '100%' }}
              />
            </div>
          )}

          <div className={styles.panelSection}>
            <div className={styles.privacyNote}>
              Your API key (when configured) is used directly from the browser. Images are sent
              directly to the selected AI provider when Generate is clicked.
            </div>
          </div>

          {needsApiKey && (
            <div className={styles.errorMsg}>
              OpenAI API key required. Click Settings in the toolbar to enter your key.
            </div>
          )}

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
                Done in {result.elapsedMilliseconds}ms ({result.modelId},{' '}
                {result.editMode === 'strict-mask'
                  ? `Strict Mask, ${result.featherPixels ?? 0}px feather`
                  : 'AI Mask'}
                )
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

          {/* Run History */}
          {runs.length > 0 && (
            <div className={styles.runsSection}>
              <label className={styles.panelLabel}>
                Run History <span>({runs.length})</span>
              </label>
              <div className={styles.runList}>
                {runs.map(run => (
                  <div key={run.id} className={styles.runItem}>
                    <div className={styles.runItemHeader}>
                      <span className={styles.runItemMeta}>{run.modelId}</span>
                      <span>{new Date(run.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div className={styles.runItemPrompt} title={run.prompt}>
                      {run.prompt}
                    </div>
                    <div className={styles.runActions}>
                      <button
                        className={styles.runBtn}
                        onClick={() => handleRestoreRunParams(run)}
                        title="Restore prompt and generation settings"
                      >
                        Load Params
                      </button>
                      <button
                        className={styles.runBtn}
                        onClick={() => handleViewRunResult(run)}
                        title="View this run's generated images"
                      >
                        View Result
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        openAiKey={openAiKey}
        onSaveKey={setOpenAiKey}
        openAiProvider={openAiProvider}
      />

      {/* Projects Modal */}
      <ProjectListModal
        isOpen={isProjectsOpen}
        activeProjectId={currentProject?.id}
        onClose={() => setIsProjectsOpen(false)}
        onSelectProject={handleSelectProject}
        onNewProject={handleNewProject}
      />
    </div>
  );
}
