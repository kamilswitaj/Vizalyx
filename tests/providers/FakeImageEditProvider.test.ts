import { describe, it, expect } from 'vitest';
import { FakeImageEditProvider } from '../../src/providers/fake/FakeImageEditProvider';

describe('FakeImageEditProvider', () => {
  it('returns fake descriptor', () => {
    const provider = new FakeImageEditProvider();
    const descriptor = provider.getDescriptor();
    expect(descriptor.id).toBe('fake');
    expect(descriptor.displayName).toBe('Fake (Dev/Test)');
    expect(descriptor.models).toHaveLength(1);
    expect(descriptor.models[0]?.id).toBe('fake-model');
  });
});
