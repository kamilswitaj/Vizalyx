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

export interface ImageEditRequest {
  readonly sourceBlob: Blob;
  readonly maskBlob: Blob;
  readonly referenceBlobs: Blob[];
  readonly prompt: string;
  readonly modelId: string;
  readonly quality: string;
}

export interface ImageEditResult {
  readonly resultBlob: Blob;
  readonly providerRequestId?: string;
  readonly elapsedMilliseconds: number;
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
