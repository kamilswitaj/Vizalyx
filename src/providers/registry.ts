import type { ImageEditProvider, ImageProviderDescriptor } from './contracts/types';

export class ProviderRegistry {
  private providers = new Map<string, ImageEditProvider>();

  register(provider: ImageEditProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): ImageEditProvider | undefined {
    return this.providers.get(id);
  }

  getAll(): ImageEditProvider[] {
    return Array.from(this.providers.values());
  }

  getDescriptors(): ImageProviderDescriptor[] {
    return this.getAll().map(p => p.getDescriptor());
  }
}
