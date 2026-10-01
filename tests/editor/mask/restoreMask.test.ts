import { describe, it, expect, beforeEach } from 'vitest';
import {
  createEmptyMask,
  applyOperation,
  rasterizeMask,
  undo,
  redo,
  MaskState,
} from '../../../src/editor/mask/maskModel';
import { rasterMaskToBlob, blobToRasterMaskOperation } from '../../../src/imaging/masks/maskExport';
import { FakeImageEditProvider } from '../../../src/providers/fake/FakeImageEditProvider';
import { strictComposite } from '../../../src/imaging/composite/StrictCompositor';
import type { RasterMask } from '../../../src/providers/contracts/types';

describe('Run Mask Restore and Rerun', () => {
  beforeEach(() => {
    // In JSDOM, setup.ts provides OffscreenCanvas and createImageBitmap mocks.
  });

  it('restores a persisted mask blob into an editable RasterOperation', async () => {
    // 1. Create original mask with a rectangle
    const originalState = applyOperation(createEmptyMask(), {
      type: 'rectangle',
      x: 2,
      y: 2,
      width: 4,
      height: 4,
      value: 255,
    });

    const originalPixels = rasterizeMask(originalState, 10, 10);
    const mask: RasterMask = {
      width: 10,
      height: 10,
      data: originalPixels,
    };

    // 2. Persist to grayscale PNG blob
    const maskBlob = await rasterMaskToBlob(mask);
    expect(maskBlob).toBeInstanceOf(Blob);

    // 3. Restore to RasterOperation
    const restoredOp = await blobToRasterMaskOperation(maskBlob);
    expect(restoredOp.type).toBe('raster');
    expect(restoredOp.width).toBe(10);
    expect(restoredOp.height).toBe(10);
    expect(restoredOp.data).toBeInstanceOf(Uint8ClampedArray);

    // 4. Initial state with restored operation
    let restoredState: MaskState = {
      operations: [restoredOp],
      historyIndex: 0,
    };

    const restoredPixels = rasterizeMask(restoredState, 10, 10);
    // Spot check pixels match
    expect(restoredPixels[0]).toBe(0); // (0,0) is outside
    expect(restoredPixels[2 * 10 + 2]).toBe(originalPixels[2 * 10 + 2]); // (2,2) inside

    // 5. Subsequent edit: add brush stroke
    restoredState = applyOperation(restoredState, {
      type: 'brush',
      points: [{ x: 0, y: 0 }],
      radius: 1,
      value: 255,
    });

    const afterBrush = rasterizeMask(restoredState, 10, 10);
    expect(afterBrush[0]).toBe(255); // (0,0) now painted

    // 6. Subsequent edit: erase stroke
    restoredState = applyOperation(restoredState, {
      type: 'erase',
      points: [{ x: 2, y: 2 }],
      radius: 1,
      value: 0,
    });

    const afterErase = rasterizeMask(restoredState, 10, 10);
    expect(afterErase[2 * 10 + 2]).toBe(0); // (2,2) now erased

    // 7. Undo erase
    restoredState = undo(restoredState);
    const afterUndo = rasterizeMask(restoredState, 10, 10);
    expect(afterUndo[2 * 10 + 2]).toBe(255); // restored back to painted

    // 8. Redo erase
    restoredState = redo(restoredState);
    const afterRedo = rasterizeMask(restoredState, 10, 10);
    expect(afterRedo[2 * 10 + 2]).toBe(0); // erased again
  });

  it('allows rerunning generation with a restored mask', async () => {
    // 1. Create a 4x4 test mask where bottom-right 2x2 is 255
    const maskData = new Uint8ClampedArray(16);
    maskData[10] = 255;
    maskData[11] = 255;
    maskData[14] = 255;
    maskData[15] = 255;

    const maskBlob = await rasterMaskToBlob({
      width: 4,
      height: 4,
      data: maskData,
    });

    // 2. Restore mask from blob
    const restoredOp = await blobToRasterMaskOperation(maskBlob);
    const state = {
      operations: [restoredOp],
      historyIndex: 0,
    };
    const activeMaskPixels = rasterizeMask(state, 4, 4);

    // 3. Fake provider edit run
    const fakeProvider = new FakeImageEditProvider();
    const sourceBlob = new Blob(['source-data'], { type: 'image/png' });
    const editResult = await fakeProvider.edit(
      {
        sourceBlob,
        mask: { width: 4, height: 4, data: activeMaskPixels },
        referenceBlobs: [],
        prompt: 'rerun test',
        modelId: 'fake-model',
        quality: 'standard',
      },
      { apiKey: '' }
    );

    expect(editResult.resultBlob).toBeInstanceOf(Blob);

    // 4. Strict Mask Compositing with restored mask
    // Pixel 0 is outside (mask 0), Pixel 15 is inside (mask 255)
    const origPixels = new Uint8ClampedArray(16 * 4);
    origPixels.fill(100); // original is color 100
    const genPixels = new Uint8ClampedArray(16 * 4);
    genPixels.fill(200); // generated is color 200

    const composited = strictComposite(origPixels, genPixels, activeMaskPixels, 4, 4);

    // Outside pixel 0: exactly original (100)
    expect(composited[0]).toBe(100);
    expect(composited[1]).toBe(100);
    expect(composited[2]).toBe(100);

    // Inside pixel 15: exactly generated (200)
    const p15 = 15 * 4;
    expect(composited[p15]).toBe(200);
    expect(composited[p15 + 1]).toBe(200);
    expect(composited[p15 + 2]).toBe(200);
  });
});
