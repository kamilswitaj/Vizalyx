import { describe, it, expect } from 'vitest';
import { strictComposite } from '../../src/imaging/composite/StrictCompositor';

function makePixels(r: number, g: number, b: number, a: number, count: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return data;
}

describe('strictComposite', () => {
  it('empty mask (all 0) returns original exactly', () => {
    const original = makePixels(100, 150, 200, 255, 4);
    const generated = makePixels(10, 20, 30, 255, 4);
    const mask = new Uint8ClampedArray(4); // all zeros
    const result = strictComposite(original, generated, mask, 2, 2);
    expect(Array.from(result)).toEqual(Array.from(original));
  });

  it('full mask (all 255) returns generated exactly', () => {
    const original = makePixels(100, 150, 200, 255, 4);
    const generated = makePixels(10, 20, 30, 128, 4);
    const mask = new Uint8ClampedArray(4).fill(255);
    const result = strictComposite(original, generated, mask, 2, 2);
    expect(Array.from(result)).toEqual(Array.from(generated));
  });

  it('partial mask blends correctly', () => {
    const original = makePixels(0, 0, 0, 255, 1);
    const generated = makePixels(255, 255, 255, 255, 1);
    const mask = new Uint8ClampedArray([128]); // 50% roughly
    const result = strictComposite(original, generated, mask, 1, 1);
    // t = 128/255 ≈ 0.502
    const expected = Math.round(255 * (128 / 255));
    expect(result[0]).toBe(expected);
    expect(result[1]).toBe(expected);
    expect(result[2]).toBe(expected);
  });

  it('preserves outside pixels exactly when mask is mixed', () => {
    // 2 pixels: first is inside (255), second is outside (0)
    const original = new Uint8ClampedArray([50, 60, 70, 255,  80, 90, 100, 255]);
    const generated = new Uint8ClampedArray([200, 210, 220, 255, 230, 240, 250, 255]);
    const mask = new Uint8ClampedArray([255, 0]); // first inside, second outside
    const result = strictComposite(original, generated, mask, 2, 1);
    // First pixel: generated
    expect(result[0]).toBe(200);
    expect(result[1]).toBe(210);
    expect(result[2]).toBe(220);
    // Second pixel: original exactly
    expect(result[4]).toBe(80);
    expect(result[5]).toBe(90);
    expect(result[6]).toBe(100);
  });

  it('throws on mismatched buffer lengths', () => {
    const original = new Uint8ClampedArray(4);
    const generated = new Uint8ClampedArray(8);
    const mask = new Uint8ClampedArray(1);
    expect(() => strictComposite(original, generated, mask, 1, 1)).toThrow();
  });
});
