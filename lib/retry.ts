export type RetryContext = {
  attempt: number;
  retriesSoFar: number;
};

export type RetryOptions = {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
  shouldRetry?: (error: unknown, context: RetryContext) => boolean;
  onRetry?: (error: unknown, context: RetryContext & { delayMs: number }) => void;
};

function asBoundedInt(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(value as number)));
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

function computeDelayMs(
  retriesSoFar: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterMs: number
) {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** retriesSoFar);
  if (jitterMs <= 0) {
    return exponential;
  }
  const jitter = Math.floor(Math.random() * (jitterMs + 1));
  return Math.min(maxDelayMs, exponential + jitter);
}

export async function retryAsync<T>(
  task: (context: RetryContext) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = asBoundedInt(options.maxRetries, 2, 0, 10);
  const baseDelayMs = asBoundedInt(options.baseDelayMs, 250, 10, 10000);
  const maxDelayMs = asBoundedInt(options.maxDelayMs, 2000, baseDelayMs, 30000);
  const jitterMs = asBoundedInt(options.jitterMs, 120, 0, 2000);
  const shouldRetry = options.shouldRetry || (() => true);

  let retriesSoFar = 0;
  while (true) {
    const attempt = retriesSoFar + 1;
    try {
      return await task({
        attempt,
        retriesSoFar
      });
    } catch (error) {
      if (retriesSoFar >= maxRetries || !shouldRetry(error, { attempt, retriesSoFar })) {
        throw error;
      }

      const delayMs = computeDelayMs(retriesSoFar, baseDelayMs, maxDelayMs, jitterMs);
      options.onRetry?.(error, { attempt, retriesSoFar, delayMs });
      await sleep(delayMs);
      retriesSoFar += 1;
    }
  }
}
