import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';

// In Node/JSDOM, native structuredClone does not clone JSDOM Blobs properly.
// Wrap structuredClone so fake-indexeddb clones JSDOM Blobs as real JSDOM Blobs.
const nativeStructuredClone = globalThis.structuredClone;
if (typeof nativeStructuredClone === 'function') {
  globalThis.structuredClone = function <T>(value: T, options?: StructuredSerializeOptions): T {
    function deepClone(val: unknown): unknown {
      if (val instanceof Blob) {
        return new Blob([val], { type: val.type });
      }
      if (val && typeof val === 'object') {
        if (Array.isArray(val)) {
          return val.map(deepClone);
        }
        if (val.constructor === Object) {
          const res: Record<string, unknown> = {};
          for (const k of Object.keys(val)) {
            res[k] = deepClone((val as Record<string, unknown>)[k]);
          }
          return res;
        }
      }
      return nativeStructuredClone(val, options);
    }
    return deepClone(value) as T;
  };
}

