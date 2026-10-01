import { describe, it, expect } from 'vitest';
import {
  createEmptyMask,
  applyOperation,
  undo,
  redo,
  clearMask,
  rasterizeMask,
  getActiveMaskOperations,
} from '../../../src/editor/mask/maskModel';

describe('maskModel', () => {
  it('creates empty mask', () => {
    const state = createEmptyMask();
    expect(state.operations).toHaveLength(0);
    expect(state.historyIndex).toBe(-1);
  });

  it('applies a rectangle operation', () => {
    let state = createEmptyMask();
    state = applyOperation(state, {
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      value: 255,
    });
    expect(state.operations).toHaveLength(1);
    expect(state.historyIndex).toBe(0);
  });

  it('undoes last operation', () => {
    let state = createEmptyMask();
    state = applyOperation(state, {
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      value: 255,
    });
    state = undo(state);
    expect(state.historyIndex).toBe(-1);
  });

  it('redoes after undo', () => {
    let state = createEmptyMask();
    state = applyOperation(state, {
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      value: 255,
    });
    state = undo(state);
    state = redo(state);
    expect(state.historyIndex).toBe(0);
  });

  it('clear appends an undoable clear operation', () => {
    let state = createEmptyMask();
    state = applyOperation(state, {
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      value: 255,
    });
    state = clearMask(state);
    expect(state.operations).toHaveLength(2);
    expect(state.historyIndex).toBe(1);

    // Rasterized mask is completely empty
    const clearedPixels = rasterizeMask(state, 10, 10);
    expect(clearedPixels.every(v => v === 0)).toBe(true);

    // Undo clear restores previous rectangle
    state = undo(state);
    const restoredPixels = rasterizeMask(state, 10, 10);
    expect(restoredPixels.some(v => v === 255)).toBe(true);

    // Redo clear re-empties the mask
    state = redo(state);
    const reClearedPixels = rasterizeMask(state, 10, 10);
    expect(reClearedPixels.every(v => v === 0)).toBe(true);
  });

  it('rasterizes rectangle mask correctly', () => {
    let state = createEmptyMask();
    state = applyOperation(state, {
      type: 'rectangle',
      x: 1,
      y: 1,
      width: 2,
      height: 2,
      value: 255,
    });
    const pixels = rasterizeMask(state, 4, 4);
    expect(pixels[0]).toBe(0); // (0,0) outside
    expect(pixels[5]).toBe(255); // (1,1) inside
    expect(pixels[6]).toBe(255); // (2,1)
    expect(pixels[9]).toBe(255); // (1,2)
    expect(pixels[10]).toBe(255); // (2,2)
    expect(pixels[15]).toBe(0); // (3,3) outside
  });

  it('rasterizes brush stroke with interpolation without gaps', () => {
    let state = createEmptyMask();
    // Stroke from (2, 5) to (18, 5) across a 20x10 image with radius 2
    state = applyOperation(state, {
      type: 'brush',
      points: [
        { x: 2, y: 5 },
        { x: 18, y: 5 },
      ],
      radius: 2,
      value: 255,
    });
    const pixels = rasterizeMask(state, 20, 10);

    // Verify all pixels along the centerline y=5 from x=2 to x=18 are 255 (no gaps)
    for (let x = 2; x <= 18; x++) {
      expect(pixels[5 * 20 + x]).toBe(255);
    }

    // Pixels far away (e.g. y=0) must remain 0
    for (let x = 0; x < 20; x++) {
      expect(pixels[0 * 20 + x]).toBe(0);
    }
  });

  it('erases through existing rectangle and brush with undo/redo support', () => {
    let state = createEmptyMask();

    // 1. Add rectangle covering 10x10 area
    state = applyOperation(state, {
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      value: 255,
    });

    // 2. Add brush stroke
    state = applyOperation(state, {
      type: 'brush',
      points: [
        { x: 10, y: 5 },
        { x: 15, y: 5 },
      ],
      radius: 2,
      value: 255,
    });

    // 3. Erase a strip cutting through the rectangle at x=5, y=0..9 with radius 1
    state = applyOperation(state, {
      type: 'erase',
      points: [
        { x: 5, y: 0 },
        { x: 5, y: 9 },
      ],
      radius: 1,
      value: 0,
    });

    const erasedPixels = rasterizeMask(state, 20, 10);
    // Center column x=5 inside rectangle should now be 0
    expect(erasedPixels[4 * 20 + 5]).toBe(0);
    expect(erasedPixels[5 * 20 + 5]).toBe(0);
    // Columns next to it (x=1) should still be 255
    expect(erasedPixels[4 * 20 + 1]).toBe(255);

    // 4. Undo erase
    state = undo(state);
    const restoredPixels = rasterizeMask(state, 20, 10);
    expect(restoredPixels[4 * 20 + 5]).toBe(255);
    expect(restoredPixels[5 * 20 + 5]).toBe(255);

    // 5. Redo erase
    state = redo(state);
    const reErasedPixels = rasterizeMask(state, 20, 10);
    expect(reErasedPixels[4 * 20 + 5]).toBe(0);
  });

  it('supports single-point clicks for brush and eraser', () => {
    let state = createEmptyMask();
    state = applyOperation(state, {
      type: 'brush',
      points: [{ x: 5, y: 5 }],
      radius: 2,
      value: 255,
    });
    const pixels = rasterizeMask(state, 10, 10);
    expect(pixels[5 * 10 + 5]).toBe(255);

    // Erase single point
    state = applyOperation(state, {
      type: 'erase',
      points: [{ x: 5, y: 5 }],
      radius: 3,
      value: 0,
    });
    const erased = rasterizeMask(state, 10, 10);
    expect(erased[5 * 10 + 5]).toBe(0);
  });

  it('getActiveMaskOperations correctly filters out operations prior to clear, with undo and redo support', () => {
    let state = createEmptyMask();
    expect(getActiveMaskOperations(state)).toEqual([]);

    // 1. Add Brush operation
    const brushOp = {
      type: 'brush' as const,
      points: [{ x: 5, y: 5 }, { x: 10, y: 10 }],
      radius: 4,
      value: 255 as const,
    };
    state = applyOperation(state, brushOp);
    expect(getActiveMaskOperations(state)).toEqual([brushOp]);

    // 2. Clear mask
    state = clearMask(state);
    expect(getActiveMaskOperations(state)).toEqual([]);

    // 3. Undo clear: restores brushOp
    state = undo(state);
    expect(getActiveMaskOperations(state)).toEqual([brushOp]);

    // 4. Redo clear: clears again
    state = redo(state);
    expect(getActiveMaskOperations(state)).toEqual([]);

    // 5. Add new rectangle after clear
    const rectOp = {
      type: 'rectangle' as const,
      x: 1,
      y: 1,
      width: 5,
      height: 5,
      value: 255 as const,
    };
    state = applyOperation(state, rectOp);
    // Only rectOp should be active, not brushOp
    expect(getActiveMaskOperations(state)).toEqual([rectOp]);
  });
});
