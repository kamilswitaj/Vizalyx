import { describe, it, expect } from 'vitest';
import { screenToImageCoords, imageToScreenCoords, ViewportTransform } from '../../../src/editor/viewport/coordinateTransform';

describe('screenToImageCoords', () => {
  it('identity transform', () => {
    const t: ViewportTransform = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, stageX: 0, stageY: 0 };
    const result = screenToImageCoords(100, 200, t);
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(200);
  });

  it('with zoom', () => {
    const t: ViewportTransform = { scaleX: 2, scaleY: 2, offsetX: 0, offsetY: 0, stageX: 0, stageY: 0 };
    const result = screenToImageCoords(200, 400, t);
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(200);
  });

  it('with pan', () => {
    const t: ViewportTransform = { scaleX: 1, scaleY: 1, offsetX: 50, offsetY: 100, stageX: 0, stageY: 0 };
    const result = screenToImageCoords(150, 300, t);
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(200);
  });

  it('with zoom and pan', () => {
    const t: ViewportTransform = { scaleX: 2, scaleY: 2, offsetX: 50, offsetY: 50, stageX: 0, stageY: 0 };
    // screen (250, 250) -> rel (250, 250) -> image ((250-50)/2, (250-50)/2) = (100, 100)
    const result = screenToImageCoords(250, 250, t);
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(100);
  });

  it('with stage offset', () => {
    const t: ViewportTransform = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, stageX: 10, stageY: 20 };
    const result = screenToImageCoords(110, 220, t);
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(200);
  });

  it('roundtrip: imageToScreen and back', () => {
    const t: ViewportTransform = { scaleX: 1.5, scaleY: 1.5, offsetX: 30, offsetY: 40, stageX: 5, stageY: 10 };
    const imageCoords = { x: 100, y: 200 };
    const screen = imageToScreenCoords(imageCoords.x, imageCoords.y, t);
    const back = screenToImageCoords(screen.x, screen.y, t);
    expect(back.x).toBeCloseTo(imageCoords.x);
    expect(back.y).toBeCloseTo(imageCoords.y);
  });
});
