import type {
  ImageEditProvider,
  ImageProviderDescriptor,
  ProviderCredentials,
  CredentialValidationResult,
  ImageEditRequest,
  ImageEditResult,
} from '../contracts/types';

const DESCRIPTOR: ImageProviderDescriptor = {
  id: 'fake',
  displayName: 'Fake (Dev/Test)',
  browserDirectSupported: true,
  models: [
    {
      id: 'fake-model',
      displayName: 'Fake Model',
      supportedQualities: ['standard'],
      supportsMask: true,
      supportsReferenceImages: true,
      supportsCustomResolution: false,
    },
  ],
};

export class FakeImageEditProvider implements ImageEditProvider {
  readonly id = 'fake';

  getDescriptor(): ImageProviderDescriptor {
    return DESCRIPTOR;
  }

  async validateCredentials(_credentials: ProviderCredentials): Promise<CredentialValidationResult> {
    return { valid: true };
  }

  async edit(
    request: ImageEditRequest,
    _credentials: ProviderCredentials,
    signal?: AbortSignal
  ): Promise<ImageEditResult> {
    const start = Date.now();

    // Simulate async work
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 150);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    // Decode source image
    const bitmap = await createImageBitmap(request.sourceBlob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');

    // Draw source
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    // Apply deterministic transformation: 50% red overlay
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#cc3333';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1.0;

    const blob = await canvas.convertToBlob({ type: 'image/png' });

    return {
      resultBlob: blob,
      elapsedMilliseconds: Date.now() - start,
    };
  }
}
