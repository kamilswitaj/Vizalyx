import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Line, Circle } from 'react-konva';
import Konva from 'konva';
import { MaskState, MaskOperation, Point } from '../mask/maskModel';
import { screenToImageCoords, ViewportTransform } from '../viewport/coordinateTransform';
import type { EditorTool } from '../tools/editorTools';

interface Props {
  sourceUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  maskState: MaskState;
  maskOpacity: number;
  activeTool?: EditorTool;
  brushRadius?: number; // source image pixels
  fitTrigger?: number;
  onMaskOperation: (op: MaskOperation) => void;
  isDrawingDisabled?: boolean;
}

export function EditorCanvas({
  sourceUrl,
  sourceWidth,
  sourceHeight,
  maskState,
  maskOpacity,
  activeTool = 'rectangle',
  brushRadius = 20,
  fitTrigger,
  onMaskOperation,
  isDrawingDisabled = false,
}: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });
  const [stageScale, setStageScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);

  // Active drawing stroke / rect
  const [isDrawing, setIsDrawing] = useState(false);
  const isDrawingRef = useRef(false);

  // Rectangle drawing coordinates
  const [rectStart, setRectStart] = useState<Point>({ x: 0, y: 0 });
  const rectStartRef = useRef<Point>({ x: 0, y: 0 });
  const [rectCurrent, setRectCurrent] = useState<Point>({ x: 0, y: 0 });

  // Brush / Eraser stroke points
  const [strokePoints, setStrokePoints] = useState<Point[]>([]);
  const strokePointsRef = useRef<Point[]>([]);

  // Pan state
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

  // Fit image to viewport
  const fitToViewport = useCallback(() => {
    if (!containerSize.width || !containerSize.height || !sourceWidth || !sourceHeight) return;
    const scaleX = containerSize.width / sourceWidth;
    const scaleY = containerSize.height / sourceHeight;
    const scale = Math.min(scaleX, scaleY) * 0.9;
    const offsetX = (containerSize.width - sourceWidth * scale) / 2;
    const offsetY = (containerSize.height - sourceHeight * scale) / 2;
    setStageScale(scale);
    setStagePos({ x: offsetX, y: offsetY });
  }, [containerSize, sourceWidth, sourceHeight]);

  // Fit on first load or size change
  useEffect(() => {
    fitToViewport();
  }, [fitToViewport]);

  // Fit triggered externally
  useEffect(() => {
    if (fitTrigger !== undefined && fitTrigger > 0) {
      fitToViewport();
    }
  }, [fitTrigger, fitToViewport]);

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
        strokePointsRef.current = [];
        setStrokePoints([]);
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
      const isPanAction = evt.button === 1 || spacePressed.current || activeTool === 'pan';

      if (isPanAction) {
        isPanning.current = true;
        lastPanPos.current = { x: evt.clientX, y: evt.clientY };
        return;
      }

      if (evt.button !== 0 || isDrawingDisabled) return;

      const transform = getViewportTransform();
      const imgCoords = screenToImageCoords(evt.clientX, evt.clientY, transform);

      if (activeTool === 'rectangle') {
        setRectStart(imgCoords);
        rectStartRef.current = imgCoords;
        setRectCurrent(imgCoords);
        setIsDrawing(true);
        isDrawingRef.current = true;
      } else if (activeTool === 'brush' || activeTool === 'eraser') {
        const initialPoints = [imgCoords];
        setStrokePoints(initialPoints);
        strokePointsRef.current = initialPoints;
        setIsDrawing(true);
        isDrawingRef.current = true;
      }
    },
    [getViewportTransform, activeTool, isDrawingDisabled]
  );

  // Global mousemove and mouseup listeners to prevent stuck state
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

        if (activeTool === 'rectangle') {
          setRectCurrent(imgCoords);
        } else if (activeTool === 'brush' || activeTool === 'eraser') {
          strokePointsRef.current = [...strokePointsRef.current, imgCoords];
          setStrokePoints(strokePointsRef.current);
        }
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

        if (activeTool === 'rectangle') {
          const start = rectStartRef.current;
          const x = Math.min(start.x, imgEnd.x);
          const y = Math.min(start.y, imgEnd.y);
          const width = Math.abs(imgEnd.x - start.x);
          const height = Math.abs(imgEnd.y - start.y);

          if (width > 1 && height > 1) {
            onMaskOperation({ type: 'rectangle', x, y, width, height, value: 255 });
          }
        } else if (activeTool === 'brush') {
          const finalPoints = [...strokePointsRef.current, imgEnd];
          if (finalPoints.length > 0) {
            onMaskOperation({
              type: 'brush',
              points: finalPoints,
              radius: brushRadius,
              value: 255,
            });
          }
          setStrokePoints([]);
          strokePointsRef.current = [];
        } else if (activeTool === 'eraser') {
          const finalPoints = [...strokePointsRef.current, imgEnd];
          if (finalPoints.length > 0) {
            onMaskOperation({
              type: 'erase',
              points: finalPoints,
              radius: brushRadius,
              value: 0,
            });
          }
          setStrokePoints([]);
          strokePointsRef.current = [];
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
  }, [getViewportTransform, activeTool, brushRadius, onMaskOperation]);

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
  const activeOps = useMemo(() => {
    const active = maskState.operations.slice(0, maskState.historyIndex + 1);
    // Find last clear op if any
    let lastClearIndex = -1;
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i]!.type === 'clear') {
        lastClearIndex = i;
        break;
      }
    }
    return lastClearIndex >= 0 ? active.slice(lastClearIndex + 1) : active;
  }, [maskState.operations, maskState.historyIndex]);

  // Preview rect in image coords for display
  const previewRect =
    isDrawing && activeTool === 'rectangle'
      ? {
          x: Math.min(rectStart.x, rectCurrent.x),
          y: Math.min(rectStart.y, rectCurrent.y),
          width: Math.abs(rectCurrent.x - rectStart.x),
          height: Math.abs(rectCurrent.y - rectStart.y),
        }
      : null;

  // Cursor style
  const cursorStyle =
    activeTool === 'pan' || spacePressed.current ? 'grab' : 'crosshair';

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', cursor: cursorStyle }}
    >
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
            if (op.type === 'brush' || op.type === 'erase') {
              const compOp = op.value === 0 ? 'destination-out' : 'source-over';
              if (op.points.length === 1) {
                return (
                  <Circle
                    key={index}
                    x={op.points[0]!.x}
                    y={op.points[0]!.y}
                    radius={op.radius}
                    fill="rgb(220, 50, 50)"
                    globalCompositeOperation={compOp}
                  />
                );
              }
              const flat = op.points.flatMap(p => [p.x, p.y]);
              return (
                <Line
                  key={index}
                  points={flat}
                  stroke="rgb(220, 50, 50)"
                  strokeWidth={op.radius * 2}
                  lineCap="round"
                  lineJoin="round"
                  globalCompositeOperation={compOp}
                />
              );
            }
            if (op.type === 'raster') {
              if (op.image) {
                return (
                  <KonvaImage
                    key={index}
                    image={op.image}
                    width={op.width}
                    height={op.height}
                  />
                );
              }
              return null;
            }
            return null;
          })}
        </Layer>

        {/* Layer 3: Interactive Preview Overlay */}
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

          {isDrawing && strokePoints.length > 0 && (activeTool === 'brush' || activeTool === 'eraser') && (
            strokePoints.length === 1 ? (
              <Circle
                x={strokePoints[0]!.x}
                y={strokePoints[0]!.y}
                radius={brushRadius}
                fill={activeTool === 'eraser' ? 'rgba(255, 255, 255, 0.5)' : 'rgba(220, 50, 50, 0.6)'}
              />
            ) : (
              <Line
                points={strokePoints.flatMap(p => [p.x, p.y])}
                stroke={activeTool === 'eraser' ? 'rgba(255, 255, 255, 0.6)' : 'rgba(220, 50, 50, 0.7)'}
                strokeWidth={brushRadius * 2}
                lineCap="round"
                lineJoin="round"
              />
            )
          )}
        </Layer>
      </Stage>
    </div>
  );
}
