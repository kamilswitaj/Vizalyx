export interface Point {
  x: number;
  y: number;
}

export type RectangleOperation = {
  type: 'rectangle';
  x: number; // source image pixel coords
  y: number;
  width: number;
  height: number;
  value: 0 | 255; // 255 = add to mask, 0 = erase
};

export type BrushOperation = {
  type: 'brush';
  points: Point[];
  radius: number; // source image pixels
  value: 255;
};

export type EraseOperation = {
  type: 'erase';
  points: Point[];
  radius: number; // source image pixels
  value: 0;
};

export type ClearOperation = {
  type: 'clear';
  value: 0;
};

export type RasterOperation = {
  type: 'raster';
  data: Uint8ClampedArray; // width * height grayscale
  width: number;
  height: number;
  image?: CanvasImageSource;
};

export type MaskOperation =
  | RectangleOperation
  | BrushOperation
  | EraseOperation
  | ClearOperation
  | RasterOperation;

export interface MaskState {
  operations: MaskOperation[];
  historyIndex: number; // points to last applied operation (for undo/redo)
}

export function createEmptyMask(): MaskState {
  return { operations: [], historyIndex: -1 };
}

export function applyOperation(state: MaskState, op: MaskOperation): MaskState {
  // Truncate redo stack, add new op
  const ops = state.operations.slice(0, state.historyIndex + 1);
  ops.push(op);
  return { operations: ops, historyIndex: ops.length - 1 };
}

export function undo(state: MaskState): MaskState {
  if (state.historyIndex < 0) return state;
  return { ...state, historyIndex: state.historyIndex - 1 };
}

export function redo(state: MaskState): MaskState {
  if (state.historyIndex >= state.operations.length - 1) return state;
  return { ...state, historyIndex: state.historyIndex + 1 };
}

export function clearMask(state: MaskState): MaskState {
  // Clear is an undoable operation
  return applyOperation(state, { type: 'clear', value: 0 });
}

function drawCircle(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  value: 0 | 255
): void {
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(height - 1, Math.ceil(cy + radius));

  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    const dy2 = dy * dy;
    const rowOffset = y * width;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      if (dx * dx + dy2 <= r2) {
        data[rowOffset + x] = value;
      }
    }
  }
}

function drawStroke(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  points: Point[],
  radius: number,
  value: 0 | 255
): void {
  if (points.length === 0) return;
  if (points.length === 1) {
    const p = points[0]!;
    drawCircle(data, width, height, p.x, p.y, radius, value);
    return;
  }

  // Step size for interpolation along stroke segments to prevent gaps
  const step = Math.max(1, radius * 0.3);

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.hypot(dx, dy);

    if (dist === 0) {
      drawCircle(data, width, height, p1.x, p1.y, radius, value);
      continue;
    }

    const steps = Math.ceil(dist / step);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = p1.x + dx * t;
      const y = p1.y + dy * t;
      drawCircle(data, width, height, x, y, radius, value);
    }
  }
}

/**
 * Returns the sequence of active operations affecting the current mask state.
 * Any operations occurring prior to the most recent active 'clear' operation
 * are discarded, preserving identical semantics between lightweight canvas rendering
 * and full rasterization.
 */
export function getActiveMaskOperations(state: MaskState): MaskOperation[] {
  if (state.historyIndex < 0) return [];
  const active = state.operations.slice(0, state.historyIndex + 1);
  let lastClearIndex = -1;
  for (let i = active.length - 1; i >= 0; i--) {
    if (active[i]!.type === 'clear') {
      lastClearIndex = i;
      break;
    }
  }
  return lastClearIndex >= 0 ? active.slice(lastClearIndex + 1) : active;
}

/**
 * Rasterize the current mask state into a single-channel Uint8ClampedArray.
 * Width and height are in source image pixels.
 */
export function rasterizeMask(
  state: MaskState,
  width: number,
  height: number
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height); // all zeros by default
  const activeOps = getActiveMaskOperations(state);

  for (const op of activeOps) {
    if (op.type === 'clear') {
      data.fill(0);
    } else if (op.type === 'rectangle') {
      const x0 = Math.max(0, Math.round(op.x));
      const y0 = Math.max(0, Math.round(op.y));
      const x1 = Math.min(width, Math.round(op.x + op.width));
      const y1 = Math.min(height, Math.round(op.y + op.height));
      for (let row = y0; row < y1; row++) {
        const offset = row * width;
        for (let col = x0; col < x1; col++) {
          data[offset + col] = op.value;
        }
      }
    } else if (op.type === 'brush' || op.type === 'erase') {
      drawStroke(data, width, height, op.points, op.radius, op.value);
    } else if (op.type === 'raster') {
      if (op.width === width && op.height === height) {
        data.set(op.data);
      } else {
        for (let row = 0; row < height; row++) {
          const srcRow = Math.min(op.height - 1, Math.floor((row / height) * op.height));
          const rowOffset = row * width;
          const srcOffset = srcRow * op.width;
          for (let col = 0; col < width; col++) {
            const srcCol = Math.min(op.width - 1, Math.floor((col / width) * op.width));
            data[rowOffset + col] = op.data[srcOffset + srcCol]!;
          }
        }
      }
    }
  }

  return data;
}
