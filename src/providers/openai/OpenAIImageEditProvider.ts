import type {
  CredentialValidationResult,
  ImageEditProvider,
  ImageEditRequest,
  ImageEditResult,
  ImageProviderDescriptor,
  ProviderCredentials,
} from '../contracts/types';
import { convertToOpenAIMaskBlob } from './OpenAIMaskAdapter';
import {
  computeOpenAIGeometry,
  prepareSourceImageBlob,
  resizeRasterMask,
  restoreResultToSourceSpace,
} from '../../imaging/geometry/ImagePreparationPlan';

const OPENAI_DESCRIPTOR: ImageProviderDescriptor = {
  id: 'openai',
  displayName: 'OpenAI',
  browserDirectSupported: true,
  models: [
    {
      id: 'gpt-image-2.5-sunburst',
      displayName: 'GPT Image 2.5 Sunburst (Precision)',
      supportedQualities: ['low', 'medium', 'high', 'xhigh', 'max'],
      supportsMask: true,
      supportsReferenceImages: true,
      supportsCustomResolution: true,
    },
    {
      id: 'gpt-image-2.5-flare',
      displayName: 'GPT Image 2.5 Flare (Speed)',
      supportedQualities: ['low', 'medium', 'high', 'xhigh', 'max'],
      supportsMask: true,
      supportsReferenceImages: true,
      supportsCustomResolution: true,
    },
  ],
};

function base64ToBlob(base64: string, mimeType = 'image/png'): Blob {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export class OpenAIImageEditProvider implements ImageEditProvider {
  readonly id = 'openai';

  getDescriptor(): ImageProviderDescriptor {
    return OPENAI_DESCRIPTOR;
  }

  async validateCredentials(credentials: ProviderCredentials): Promise<CredentialValidationResult> {
    const key = credentials.apiKey?.trim();
    if (!key) {
      return { valid: false, error: 'API key cannot be empty' };
    }

    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          Authorization: `Bearer ${key}`,
        },
      });

      if (response.ok) {
        return { valid: true };
      }

      if (response.status === 401) {
        return { valid: false, error: 'Invalid API key. Please check your OpenAI credentials.' };
      }

      if (response.status === 429) {
        return { valid: false, error: 'OpenAI quota or rate limit exceeded for this account.' };
      }

      return { valid: false, error: `Validation failed with status ${response.status}` };
    } catch (e) {
      return {
        valid: false,
        error: e instanceof Error ? e.message : 'Network error validating credentials',
      };
    }
  }

  async edit(
    request: ImageEditRequest,
    credentials: ProviderCredentials,
    signal?: AbortSignal
  ): Promise<ImageEditResult> {
    const startTime = Date.now();
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const key = credentials.apiKey?.trim();
    if (!key) {
      throw new Error('OpenAI API key is missing. Please set your key in Settings.');
    }

    // 1. Geometry normalization
    const { width: srcWidth, height: srcHeight } = request.mask;
    const geometry = computeOpenAIGeometry(srcWidth, srcHeight);

    // Canonicalize the editable source image to PNG matching target dimensions
    const preparedSourceBlob = await prepareSourceImageBlob(
      request.sourceBlob,
      geometry.targetWidth,
      geometry.targetHeight
    );
    const preparedMask = geometry.needsResize
      ? resizeRasterMask(request.mask, geometry.targetWidth, geometry.targetHeight)
      : request.mask;

    // 2. Mask conversion with inverted alpha for OpenAI API
    const openAiMaskBlob = await convertToOpenAIMaskBlob(preparedMask);

    // 3. Build multipart request conforming to GPT Image 2.5 API:
    // - Source image must be FIRST in image[] because the mask applies to the first image
    // - Reference images follow after the source image in image[]
    // - Explicit size matching prepared geometry
    // - Do not send response_format (unsupported for GPT Image 2.5, b64_json returned by default)
    const formData = new FormData();
    formData.append('image[]', preparedSourceBlob, 'source.png');

    if (request.referenceBlobs && request.referenceBlobs.length > 0) {
      for (let i = 0; i < request.referenceBlobs.length; i++) {
        formData.append('image[]', request.referenceBlobs[i]!, `reference-${i + 1}.png`);
      }
    }

    formData.append('mask', openAiMaskBlob, 'mask.png');
    formData.append('prompt', request.prompt);
    formData.append('model', request.modelId);
    formData.append('quality', request.quality);
    formData.append('size', `${geometry.targetWidth}x${geometry.targetHeight}`);


    // 4. Send directly from browser to OpenAI
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
        },
        body: formData,
        signal,
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      throw new Error(
        `Network error contacting OpenAI: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!response.ok) {
      let errorMsg = `OpenAI API error (${response.status})`;
      try {
        const errJson = await response.json();
        if (errJson?.error?.message) {
          errorMsg = errJson.error.message;
        }
      } catch {
        // Fallback to status text
      }

      if (response.status === 401) {
        throw new Error('OpenAI authentication failed: Invalid API key.');
      }
      if (response.status === 429) {
        throw new Error('OpenAI rate limit or usage quota exceeded.');
      }
      throw new Error(errorMsg);
    }

    const json = await response.json();
    const b64Data = json?.data?.[0]?.b64_json;
    if (!b64Data) {
      throw new Error('OpenAI returned an unexpected response format without image data.');
    }

    let resultBlob = base64ToBlob(b64Data, 'image/png');

    // 5. Restore geometry back to source space if normalized
    if (geometry.needsResize) {
      resultBlob = await restoreResultToSourceSpace(resultBlob, srcWidth, srcHeight);
    }

    return {
      resultBlob,
      providerRequestId: response.headers.get('x-request-id') ?? undefined,
      elapsedMilliseconds: Date.now() - startTime,
    };
  }
}
