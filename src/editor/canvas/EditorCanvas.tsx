import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect } from 'react-konva';
import Konva from 'konva';
import { MaskState, MaskOperation } from '../mask/maskModel';
import { screenToImageCoords, ViewportTransform } from '../viewport/coordinateTransform';

interface Props {
  sourceUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  maskState: MaskState;
  maskOpacity: number;
  onMaskOperation: (op: MaskOperation) => void;
}

export function EditorCanvas({
  sourceUrl,
  sourceWidth,
  sourceHeight,
  maskState,
  maskOpacity,
  onMaskOperation,
}: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });
  const [stageScale, setStageScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);

  // Rectangle drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const isDrawingRef = useRef(false);
  const [rectStart, setRectStart] = useState({ x: 0, y: 0 }); // image coords
  const rectStartRef = useRef({ x: 0, y: 0 });
  const [rectCurrent, setRectCurrent] = useState({ x: 0, y: 0 }); // image coords

  const isPanning = useRef(false);
  const lastPanPos = useRef({ x: 0, y: 0 });
  const spacePressed = useRef(false);

  // Observe container size
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(container);
    setContainerSize({ width: container.clientWidth, height: container.clientHeight });
    return () => observer.disconnect();
  }, []);

  // Fit image to viewport on first load or size change
  useEffect(() => {
    if (!containerSize.width || !containerSize.height) return;
    const scaleX = containerSize.width / sourceWidth;
    const scaleY = containerSize.height / sourceHeight;
    const scale = Math.min(scaleX, scaleY) * 0.9;
    const offsetX = (containerSize.width - sourceWidth * scale) / 2;
    const offsetY = (containerSize.height - sourceHeight * scale) / 2;
    setStageScale(scale);
    setStagePos({ x: offsetX, y: offsetY });
  }, [sourceWidth, sourceHeight, containerSize]);

  // Load source image element
  useEffect(() => {
    const img = new window.Image();
    img.src = sourceUrl;
    img.onload = () => setSourceImage(img);
    return () => {
      img.onload = null;
    };
  }, [sourceUrl]);

  // Keyboard pan with input/textarea protection and blur reset
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (isEditable) {
        return;
      }

      if (e.code === 'Space') {
        spacePressed.current = true;
        e.preventDefault();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spacePressed.current = false;
      }
    };

    const onBlur = () => {
      spacePressed.current = false;
      isPanning.current = false;
      if (isDrawingRef.current) {
        isDrawingRef.current = false;
        setIsDrawing(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const getViewportTransform = useCallback((): ViewportTransform => {
    const rect = containerRef.current?.getBoundingClientRect();
    return {
      scaleX: stageScale,
      scaleY: stageScale,
      offsetX: stagePos.x,
      offsetY: stagePos.y,
      stageX: rect?.left ?? 0,
      stageY: rect?.top ?? 0,
    };
  }, [stageScale, stagePos]);

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const evt = e.evt;
      if (evt.button === 1 || spacePressed.current) {
        // Middle mouse or space = pan
        isPanning.current = true;
        lastPanPos.current = { x: evt.clientX, y: evt.clientY };
        return;
      }
      if (evt.button !== 0) return; // Only primary button for drawing

      // Left button = rectangle draw
      const transform = getViewportTransform();
      const imgCoords = screenToImageCoords(evt.clientX, evt.clientY, transform);
      setRectStart(imgCoords);
      rectStartRef.current = imgCoords;
      setRectCurrent(imgCoords);
      setIsDrawing(true);
      isDrawingRef.current = true;
    },
    [getViewportTransform]
  );

  // Global mousemove and mouseup listeners to prevent stuck drawing/panning
  useEffect(() => {
    const onWindowMouseMove = (e: MouseEvent) => {
      if (isPanning.current) {
        const dx = e.clientX - lastPanPos.current.x;
        const dy = e.clientY - lastPanPos.current.y;
        lastPanPos.current = { x: e.clientX, y: e.clientY };
        setStagePos(prev => ({ x: prev.x + dx, y: prev.y + dy }));
        return;
      }
      if (isDrawingRef.current) {
        const transform = getViewportTransform();
        const imgCoords = screenToImageCoords(e.clientX, e.clientY, transform);
        setRectCurrent(imgCoords);
      }
    };

    const onWindowMouseUp = (e: MouseEvent) => {
      if (isPanning.current) {
        isPanning.current = false;
      }
      if (isDrawingRef.current) {
        isDrawingRef.current = false;
        setIsDrawing(false);

        const transform = getViewportTransform();
        const imgEnd = screenToImageCoords(e.clientX, e.clientY, transform);
        const start = rectStartRef.current;

        const x = Math.min(start.x, imgEnd.x);
        const y = Math.min(start.y, imgEnd.y);
        const width = Math.abs(imgEnd.x - start.x);
        const height = Math.abs(imgEnd.y - start.y);

        if (width > 1 && height > 1) {
          onMaskOperation({ type: 'rectangle', x, y, width, height, value: 255 });
        }
      }
    };

    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);
    window.addEventListener('pointerup', onWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
      window.removeEventListener('pointerup', onWindowMouseUp);
    };
  }, [getViewportTransform, onMaskOperation]);

  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const scaleBy = 1.1;
      const stage = stageRef.current;
      if (!stage) return;

      const oldScale = stageScale;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
      const clampedScale = Math.max(0.05, Math.min(20, newScale));

      const mousePointTo = {
        x: (pointer.x - stagePos.x) / oldScale,
        y: (pointer.y - stagePos.y) / oldScale,
      };

      setStageScale(clampedScale);
      setStagePos({
        x: pointer.x - mousePointTo.x * clampedScale,
        y: pointer.y - mousePointTo.y * clampedScale,
      });
    },
    [stageScale, stagePos]
  );

  // Active operations from mask history
  const activeOps = useMemo(
    () => maskState.operations.slice(0, maskState.historyIndex + 1),
    [maskState.operations, maskState.historyIndex]
  );

  // Preview rect in image coords -> stage coords for display
  const previewRect = isDrawing
    ? {
        x: Math.min(rectStart.x, rectCurrent.x),
        y: Math.min(rectStart.y, rectCurrent.y),
        width: Math.abs(rectCurrent.x - rectStart.x),
        height: Math.abs(rectCurrent.y - rectStart.y),
      }
    : null;

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <Stage
        ref={stageRef}
        width={containerSize.width}
        height={containerSize.height}
        scaleX={stageScale}
        scaleY={stageScale}
        x={stagePos.x}
        y={stagePos.y}
        onMouseDown={handleMouseDown}
        onWheel={handleWheel}
      >
        {/* Layer 1: Source Image */}
        <Layer listening={false}>
          {sourceImage && (
            <KonvaImage image={sourceImage} width={sourceWidth} height={sourceHeight} />
          )}
        </Layer>

        {/* Layer 2: Lightweight Mask Visualization */}
        <Layer listening={false} opacity={maskOpacity}>
          {activeOps.map((op, index) => {
            if (op.type === 'rectangle') {
              return (
                <Rect
                  key={index}
                  x={op.x}
                  y={op.y}
                  width={op.width}
                  height={op.height}
                  fill="rgb(220, 50, 50)"
                  globalCompositeOperation={op.value === 0 ? 'destination-out' : 'source-over'}
                />
              );
            }
            return null;
          })}
        </Layer>

        {/* Layer 3: UI Interaction Overlay */}
        <Layer listening={false}>
          {previewRect && (
            <Rect
              x={previewRect.x}
              y={previewRect.y}
              width={previewRect.width}
              height={previewRect.height}
              fill="rgba(120, 160, 255, 0.3)"
              stroke="#7aa3ff"
              strokeWidth={1 / stageScale}
            />
          )}
        </Layer>
      </Stage>
    </div>
  );
}
