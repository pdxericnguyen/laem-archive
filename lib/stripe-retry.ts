import { retryAsync, type RetryOptions } from "@/lib/retry";

const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function asBoundedInt(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function isNodeNetworkErrorCode(value: unknown) {
  if (typeof value !== "string") {
    return false;
  }
  return (
    value === "ECONNRESET" ||
    value === "ETIMEDOUT" ||
    value === "ESOCKETTIMEDOUT" ||
    value === "EAI_AGAIN" ||
    value === "ENOTFOUND" ||
    value === "ECONNREFUSED"
  );
}

export function isRetryableStripeError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const row = error as Record<string, unknown>;
  const statusCode = typeof row.statusCode === "number" ? row.statusCode : null;
  if (statusCode !== null && RETRYABLE_STATUS_CODES.has(statusCode)) {
    return true;
  }

  const type = typeof row.type === "string" ? row.type : "";
  if (
    type === "StripeConnectionError" ||
    type === "StripeAPIError" ||
    type === "StripeRateLimitError" ||
    type === "StripeIdempotencyError"
  ) {
    return true;
  }

  if (isNodeNetworkErrorCode(row.code)) {
    return true;
  }

  const message = typeof row.message === "string" ? row.message : "";
  if (/timed out|timeout|econnreset|socket hang up|temporarily unavailable/i.test(message)) {
    return true;
  }

  return false;
}

export async function retryStripeOperation<T>(
  operationName: string,
  task: () => Promise<T>,
  options: RetryOptions = {}
) {
  const maxRetries = asBoundedInt(
    options.maxRetries === undefined ? process.env.STRIPE_RETRY_MAX_RETRIES : String(options.maxRetries),
    2,
    0,
    6
  );
  const baseDelayMs = asBoundedInt(
    options.baseDelayMs === undefined ? process.env.STRIPE_RETRY_BASE_DELAY_MS : String(options.baseDelayMs),
    300,
    50,
    10000
  );
  const maxDelayMs = asBoundedInt(
    options.maxDelayMs === undefined ? process.env.STRIPE_RETRY_MAX_DELAY_MS : String(options.maxDelayMs),
    2200,
    baseDelayMs,
    30000
  );
  const shouldLogRetries =
    String(process.env.STRIPE_RETRY_LOGS || "").toLowerCase() === "true" ||
    process.env.NODE_ENV === "development";
  return retryAsync(task, {
    maxRetries,
    baseDelayMs,
    maxDelayMs,
    jitterMs: options.jitterMs,
    shouldRetry: (error, context) => {
      const userShouldRetry = options.shouldRetry ? options.shouldRetry(error, context) : true;
      return userShouldRetry && isRetryableStripeError(error);
    },
    onRetry: (error, context) => {
      if (shouldLogRetries) {
        console.warn(`Retrying Stripe operation: ${operationName}`, {
          attempt: context.attempt,
          retriesSoFar: context.retriesSoFar,
          delayMs: context.delayMs,
          error
        });
      }
      options.onRetry?.(error, context);
    }
  });
}
