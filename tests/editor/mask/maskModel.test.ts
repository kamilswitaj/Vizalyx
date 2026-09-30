import { describe, it, expect } from 'vitest';
import {
  createEmptyMask,
  applyOperation,
  undo,
  redo,
  clearMask,
  rasterizeMask,
} from '../../../src/editor/mask/maskModel';

describe('maskModel', () => {
  it('creates empty mask', () => {
    const state = createEmptyMask();
    expect(state.operations).toHaveLength(0);
    expect(state.historyIndex).toBe(-1);
  });

  it('applies a rectangle operation', () => {
    let state = createEmptyMask();
    state = applyOperation(state, { type: 'rectangle', x: 0, y: 0, width: 10, height: 10, value: 255 });
    expect(state.operations).toHaveLength(1);
    expect(state.historyIndex).toBe(0);
  });

  it('undoes last operation', () => {
    let state = createEmptyMask();
    state = applyOperation(state, { type: 'rectangle', x: 0, y: 0, width: 10, height: 10, value: 255 });
    state = undo(state);
    expect(state.historyIndex).toBe(-1);
  });

  it('redoes after undo', () => {
    let state = createEmptyMask();
    state = applyOperation(state, { type: 'rectangle', x: 0, y: 0, width: 10, height: 10, value: 255 });
    state = undo(state);
    state = redo(state);
    expect(state.historyIndex).toBe(0);
  });

  it('clear resets mask', () => {
    let state = createEmptyMask();
    state = applyOperation(state, { type: 'rectangle', x: 0, y: 0, width: 10, height: 10, value: 255 });
    state = clearMask(state);
    expect(state.operations).toHaveLength(0);
    expect(state.historyIndex).toBe(-1);
  });

  it('rasterizes rectangle mask correctly', () => {
    let state = createEmptyMask();
    state = applyOperation(state, { type: 'rectangle', x: 1, y: 1, width: 2, height: 2, value: 255 });
    // 4x4 image, rect at (1,1) size 2x2 covers pixels (1,1),(2,1),(1,2),(2,2)
    const pixels = rasterizeMask(state, 4, 4);
    expect(pixels[0]).toBe(0);   // (0,0) outside
    expect(pixels[5]).toBe(255); // (1,1) inside: row=1, col=1 -> index=5
    expect(pixels[6]).toBe(255); // (2,1)
    expect(pixels[9]).toBe(255); // (1,2)
    expect(pixels[10]).toBe(255); // (2,2)
    expect(pixels[15]).toBe(0);  // (3,3) outside
  });

  it('undo removes rectangle from rasterized mask', () => {
    let state = createEmptyMask();
    state = applyOperation(state, { type: 'rectangle', x: 0, y: 0, width: 4, height: 4, value: 255 });
    state = undo(state);
    const pixels = rasterizeMask(state, 4, 4);
    expect(pixels.every(v => v === 0)).toBe(true);
  });

  it('truncates redo stack when new operation applied after undo', () => {
    let state = createEmptyMask();
    state = applyOperation(state, { type: 'rectangle', x: 0, y: 0, width: 4, height: 4, value: 255 });
    state = undo(state);
    state = applyOperation(state, { type: 'rectangle', x: 1, y: 1, width: 2, height: 2, value: 255 });
    // Should only have 1 operation (redo stack cleared)
    expect(state.operations).toHaveLength(1);
    expect(state.historyIndex).toBe(0);
  });
});
