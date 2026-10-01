export interface OpenAIErrorObject {
  message?: string;
  type?: string;
  code?: string | number | null;
  param?: string | null;
}

export interface OpenAIErrorPayload {
  error?: OpenAIErrorObject;
}

/**
 * Strips any potential API key substrings from messages to ensure credentials are never leaked.
 */
export function sanitizeErrorMessage(msg: string): string {
  return msg.replace(/sk-[a-zA-Z0-9_\-]{16,}/g, '[REDACTED]');
}

/**
 * Parses and formats OpenAI non-success responses into descriptive, user-friendly
 * diagnostic messages preserving code and request-id.
 */
export function parseOpenAIError(
  status: number,
  errorPayload?: OpenAIErrorPayload | null,
  requestId?: string | null
): string {
  const err = errorPayload?.error;
  const rawCode =
    err?.code != null && String(err.code).trim() !== '' ? String(err.code).trim() : undefined;
  const rawType =
    err?.type != null && String(err.type).trim() !== '' ? String(err.type).trim() : undefined;
  const rawMsg = err?.message != null ? sanitizeErrorMessage(String(err.message).trim()) : '';

  const codeKey = (rawCode || '').toLowerCase();
  const typeKey = (rawType || '').toLowerCase();
  const msgLower = rawMsg.toLowerCase();

  // Diagnostics tags: [Code: ..., Request ID: ...]
  const tags: string[] = [];
  if (rawCode) {
    tags.push(`Code: ${rawCode}`);
  } else if (rawType) {
    tags.push(`Type: ${rawType}`);
  }
  if (!rawCode && !rawType && status) {
    tags.push(`Status: ${status}`);
  }
  if (requestId) {
    tags.push(`Request ID: ${requestId}`);
  }
  const diagSuffix = tags.length > 0 ? ` [${tags.join(', ')}]` : '';

  // 1. Credit balance exhausted
  if (
    codeKey === 'credit_balance_exhausted' ||
    typeKey === 'credit_balance_exhausted' ||
    msgLower.includes('credit_balance_exhausted') ||
    (status === 429 && msgLower.includes('credit balance'))
  ) {
    const detail = rawMsg || 'Your account credit balance has been exhausted.';
    return `OpenAI credit balance exhausted: ${detail}${diagSuffix}`;
  }

  // 2. Organization usage limit exceeded
  if (
    codeKey === 'organization_usage_limit_exceeded' ||
    typeKey === 'organization_usage_limit_exceeded' ||
    msgLower.includes('organization_usage_limit_exceeded') ||
    (status === 429 && msgLower.includes('organization usage limit'))
  ) {
    const detail = rawMsg || 'Organization usage limit has been exceeded.';
    return `OpenAI organization usage limit exceeded: ${detail}${diagSuffix}`;
  }

  // 3. Organization spend limit exceeded
  if (
    codeKey === 'organization_spend_limit_exceeded' ||
    typeKey === 'organization_spend_limit_exceeded' ||
    msgLower.includes('organization_spend_limit_exceeded') ||
    (status === 429 && msgLower.includes('organization spend limit'))
  ) {
    const detail = rawMsg || 'Organization spend limit has been exceeded.';
    return `OpenAI organization spend limit exceeded: ${detail}${diagSuffix}`;
  }

  // 4. Project spend limit exceeded
  if (
    codeKey === 'project_spend_limit_exceeded' ||
    typeKey === 'project_spend_limit_exceeded' ||
    msgLower.includes('project_spend_limit_exceeded') ||
    (status === 429 && msgLower.includes('project spend limit'))
  ) {
    const detail = rawMsg || 'Project spend limit has been exceeded.';
    return `OpenAI project spend limit exceeded: ${detail}${diagSuffix}`;
  }

  // 5. Insufficient quota
  if (
    codeKey === 'insufficient_quota' ||
    typeKey === 'insufficient_quota' ||
    msgLower.includes('insufficient_quota') ||
    (status === 429 &&
      (msgLower.includes('exceeded your current quota') || msgLower.includes('insufficient quota')))
  ) {
    const detail = rawMsg || 'Insufficient quota. Please check your plan and billing details.';
    return `OpenAI quota exceeded (insufficient quota): ${detail}${diagSuffix}`;
  }

  // 6. Actual rate limit (RPM, TPM, concurrent requests)
  if (
    codeKey === 'rate_limit_exceeded' ||
    typeKey === 'requests' ||
    typeKey === 'tokens' ||
    typeKey === 'rate_limit_exceeded' ||
    msgLower.includes('rate limit') ||
    msgLower.includes('requests per min') ||
    msgLower.includes('tokens per min')
  ) {
    const detail =
      rawMsg ||
      'Rate limit reached for requests or tokens. Please wait a moment before retrying.';
    return `OpenAI rate limit exceeded: ${detail}${diagSuffix}`;
  }

  // 7. Unknown 429
  if (status === 429) {
    const detail = rawMsg || 'Too many requests or rate limit reached.';
    return `OpenAI request limit reached (HTTP 429): ${detail}${diagSuffix}`;
  }

  // 8. Authentication 401
  if (status === 401) {
    const detail = rawMsg || 'Invalid API key or authentication failure.';
    return `OpenAI authentication failed: ${detail}${diagSuffix}`;
  }

  // 9. Other HTTP errors (400, 500, etc.)
  const detail = rawMsg || `Request failed with HTTP status ${status}.`;
  return `OpenAI API error (${status}): ${detail}${diagSuffix}`;
}
