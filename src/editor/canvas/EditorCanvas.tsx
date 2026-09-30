import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect } from 'react-konva';
import Konva from 'konva';
import { MaskState, MaskOperation, rasterizeMask } from '../mask/maskModel';
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
  const [maskImage, setMaskImage] = useState<HTMLCanvasElement | null>(null);

  // Rectangle drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [rectStart, setRectStart] = useState({ x: 0, y: 0 }); // image coords
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
    return () => { img.onload = null; };
  }, [sourceUrl]);

  // Re-render mask canvas whenever maskState changes
  useEffect(() => {
    const maskPixels = rasterizeMask(maskState, sourceWidth, sourceHeight);
    const canvas = document.createElement('canvas');
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imageData = ctx.createImageData(sourceWidth, sourceHeight);
    for (let i = 0; i < maskPixels.length; i++) {
      const v = maskPixels[i]!;
      imageData.data[i * 4] = 220;     // R
      imageData.data[i * 4 + 1] = 50;  // G
      imageData.data[i * 4 + 2] = 50;  // B
      imageData.data[i * 4 + 3] = v;   // A from mask value
    }
    ctx.putImageData(imageData, 0, 0);
    setMaskImage(canvas);
  }, [maskState, sourceWidth, sourceHeight]);

  // Keyboard pan
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spacePressed.current = true;
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spacePressed.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
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

  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const evt = e.evt;
    if (evt.button === 1 || spacePressed.current) {
      // Middle mouse or space = pan
      isPanning.current = true;
      lastPanPos.current = { x: evt.clientX, y: evt.clientY };
      return;
    }
    // Left button = rectangle draw
    const transform = getViewportTransform();
    const imgCoords = screenToImageCoords(evt.clientX, evt.clientY, transform);
    setRectStart(imgCoords);
    setRectCurrent(imgCoords);
    setIsDrawing(true);
  }, [getViewportTransform]);

  const handleMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const evt = e.evt;
    if (isPanning.current) {
      const dx = evt.clientX - lastPanPos.current.x;
      const dy = evt.clientY - lastPanPos.current.y;
      lastPanPos.current = { x: evt.clientX, y: evt.clientY };
      setStagePos(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      return;
    }
    if (isDrawing) {
      const transform = getViewportTransform();
      const imgCoords = screenToImageCoords(evt.clientX, evt.clientY, transform);
      setRectCurrent(imgCoords);
    }
  }, [isPanning, isDrawing, getViewportTransform]);

  const handleMouseUp = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (isPanning.current) {
      isPanning.current = false;
      return;
    }
    if (!isDrawing) return;
    setIsDrawing(false);

    const transform = getViewportTransform();
    const imgEnd = screenToImageCoords(e.evt.clientX, e.evt.clientY, transform);

    const x = Math.min(rectStart.x, imgEnd.x);
    const y = Math.min(rectStart.y, imgEnd.y);
    const width = Math.abs(imgEnd.x - rectStart.x);
    const height = Math.abs(imgEnd.y - rectStart.y);

    if (width > 1 && height > 1) {
      onMaskOperation({ type: 'rectangle', x, y, width, height, value: 255 });
    }
  }, [isDrawing, rectStart, getViewportTransform, onMaskOperation]);

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
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
  }, [stageScale, stagePos]);

  // Preview rect in image coords -> stage coords for display
  const previewRect = isDrawing ? {
    x: Math.min(rectStart.x, rectCurrent.x),
    y: Math.min(rectStart.y, rectCurrent.y),
    width: Math.abs(rectCurrent.x - rectStart.x),
    height: Math.abs(rectCurrent.y - rectStart.y),
  } : null;

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
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
      >
        <Layer>
          {sourceImage && (
            <KonvaImage
              image={sourceImage}
              width={sourceWidth}
              height={sourceHeight}
            />
          )}
          {maskImage && (
            <KonvaImage
              image={maskImage}
              width={sourceWidth}
              height={sourceHeight}
              opacity={maskOpacity}
            />
          )}
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
