/**
 * Mask operations stored in source-image pixel coordinates.
 * We record logical operations rather than pixel snapshots
 * to support undo/redo efficiently.
 */
export type RectangleOperation = {
  type: 'rectangle';
  x: number;      // source image pixel coords
  y: number;
  width: number;
  height: number;
  value: 0 | 255; // 255 = add to mask, 0 = erase
};

export type MaskOperation = RectangleOperation;
// Future: BrushOperation | EraseOperation etc.

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

export function clearMask(_state: MaskState): MaskState {
  return createEmptyMask();
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

  const activeOps = state.operations.slice(0, state.historyIndex + 1);

  for (const op of activeOps) {
    if (op.type === 'rectangle') {
      const x0 = Math.max(0, Math.round(op.x));
      const y0 = Math.max(0, Math.round(op.y));
      const x1 = Math.min(width, Math.round(op.x + op.width));
      const y1 = Math.min(height, Math.round(op.y + op.height));
      for (let row = y0; row < y1; row++) {
        for (let col = x0; col < x1; col++) {
          data[row * width + col] = op.value;
        }
      }
    }
  }

  return data;
}
