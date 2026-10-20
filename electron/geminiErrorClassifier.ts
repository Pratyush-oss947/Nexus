export interface ClassifiedApiError {
  type:
    | 'QUOTA_EXHAUSTED'
    | 'RATE_LIMITED'
    | 'INVALID_API_KEY'
    | 'BILLING_DISABLED'
    | 'MODEL_NOT_FOUND'
    | 'CONTEXT_OVERFLOW'
    | 'NETWORK_ERROR'
    | 'UNKNOWN';
  userMessage: string;
  isRetryable: boolean;
  suggestedWaitMs?: number;
}

export function classifyGeminiError(err: any): ClassifiedApiError {
  const msg = (err?.message || String(err || '')).toLowerCase();
  const status = err?.status || err?.statusCode || (err?.response && err.response.status);

  // 1. Invalid or Expired API Key
  if (
    status === 400 &&
    (msg.includes('api_key_invalid') ||
      msg.includes('api key not valid') ||
      msg.includes('invalid api key') ||
      msg.includes('unregistered'))
  ) {
    return {
      type: 'INVALID_API_KEY',
      userMessage: 'Invalid or expired Gemini API key. Please configure a valid key in Settings or .env.',
      isRetryable: false,
    };
  }

  if (status === 403 && (msg.includes('permission_denied') || msg.includes('forbidden'))) {
    if (msg.includes('billing')) {
      return {
        type: 'BILLING_DISABLED',
        userMessage: 'Billing is disabled or not enabled for this Google Cloud / AI Studio project.',
        isRetryable: false,
      };
    }
    return {
      type: 'INVALID_API_KEY',
      userMessage: 'Gemini API permission denied. Please verify your API key and project permissions.',
      isRetryable: false,
    };
  }

  // 2. HTTP 429 Quota Exhaustion vs Transient Rate Limit
  if (status === 429 || msg.includes('429') || msg.includes('resource_exhausted')) {
    // Check if server specified retry delay
    let retryWaitMs: number | undefined;
    const retryHeader =
      err?.response?.headers?.get?.('retry-after') ||
      err?.headers?.['retry-after'];
    if (retryHeader) {
      const parsedSeconds = parseInt(retryHeader, 10);
      if (!isNaN(parsedSeconds) && parsedSeconds > 0 && parsedSeconds <= 60) {
        retryWaitMs = parsedSeconds * 1000;
      }
    }

    // Check if it is a daily or project quota exhaustion
    if (
      msg.includes('quota') ||
      msg.includes('resource_exhausted') ||
      msg.includes('resource has been exhausted') ||
      msg.includes('daily') ||
      msg.includes('generaterequestsperday') ||
      msg.includes('billing')
    ) {
      return {
        type: 'QUOTA_EXHAUSTED',
        userMessage:
          'Gemini API daily or monthly quota exhausted. Please check your Google AI Studio plan, verify billing, or wait for your quota to reset.',
        isRetryable: false,
      };
    }

    // Otherwise treat as transient rate limiting (e.g. RPM / requests per minute)
    return {
      type: 'RATE_LIMITED',
      userMessage: 'Gemini API temporary rate limit reached. Backing off before next request.',
      isRetryable: true,
      suggestedWaitMs: retryWaitMs || 2500,
    };
  }

  // 3. Model Not Found / Unsupported Model
  if (status === 404 || msg.includes('404') || msg.includes('not_found') || msg.includes('model not found')) {
    return {
      type: 'MODEL_NOT_FOUND',
      userMessage: 'Configured Gemini model is not found or unsupported for this API tier.',
      isRetryable: false,
    };
  }

  // 4. Context Overflow
  if (
    msg.includes('context length') ||
    msg.includes('token limit') ||
    msg.includes('too large') ||
    msg.includes('maximum context')
  ) {
    return {
      type: 'CONTEXT_OVERFLOW',
      userMessage: 'Request exceeded model context length. Compacting task history.',
      isRetryable: false,
    };
  }

  // 5. Network / Timeout
  if (
    msg.includes('fetch failed') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    msg.includes('network') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('econnrefused')
  ) {
    return {
      type: 'NETWORK_ERROR',
      userMessage: msg.includes('timed out') || msg.includes('timeout')
        ? 'Model request timed out. Retrying or halting to prevent hanging.'
        : 'Network error communicating with Gemini API. Check your internet connection.',
      isRetryable: true,
      suggestedWaitMs: 1500,
    };
  }

  // 6. Generic / Unknown Error
  return {
    type: 'UNKNOWN',
    userMessage: `Gemini API Error: ${err?.message ? err.message.slice(0, 150) : 'Unexpected response'}`,
    isRetryable: false,
  };
}

/**
 * Computes backoff delay with jitter
 */
export function calculateBackoffMs(
  attempt: number,
  baseWaitMs = 1500,
  maxWaitMs = 8000
): number {
  const exponential = baseWaitMs * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 400);
  return Math.min(maxWaitMs, exponential + jitter);
}
