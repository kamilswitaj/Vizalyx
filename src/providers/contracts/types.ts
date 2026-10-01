export interface ImageProviderDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly browserDirectSupported: boolean;
  readonly models: ImageModelDescriptor[];
}

export interface ImageModelDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly supportedQualities: string[];
  readonly supportsMask: boolean;
  readonly supportsReferenceImages: boolean;
  readonly supportsCustomResolution: boolean;
}

export interface ProviderCredentials {
  readonly apiKey: string;
}

export interface CredentialValidationResult {
  readonly valid: boolean;
  readonly error?: string;
}

/**
 * Provider-independent internal raster mask representation.
 * Vizalyx semantics:
 *   0     = preserve original exactly
 *   255   = editable
 *   1-254 = partial blend / feather
 */
export interface RasterMask {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface ImageEditRequest {
  readonly sourceBlob: Blob;
  readonly mask: RasterMask;
  readonly referenceBlobs: Blob[];
  readonly prompt: string;
  readonly modelId: string;
  readonly quality: string;
}

/**
 * Provider-neutral token usage details.
 */
export interface TokenUsageDetails {
  readonly inputTextTokens?: number;
  readonly inputImageTokens?: number;
  readonly outputImageTokens?: number;
  readonly totalTokens?: number;
}

export interface ImageEditResult {
  readonly resultBlob: Blob;
  readonly providerRequestId?: string;
  readonly elapsedMilliseconds: number;
  readonly usage?: TokenUsageDetails;
  readonly costUsd?: number;
  readonly rawUsage?: unknown;
}

export interface ImageEditProvider {
  readonly id: string;
  getDescriptor(): ImageProviderDescriptor;
  validateCredentials(credentials: ProviderCredentials): Promise<CredentialValidationResult>;
  edit(
    request: ImageEditRequest,
    credentials: ProviderCredentials,
    signal?: AbortSignal
  ): Promise<ImageEditResult>;
}
