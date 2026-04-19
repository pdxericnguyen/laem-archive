import { expect, test } from "@playwright/test";

import { retryAsync } from "../../lib/retry";
import { isRetryableStripeError, retryStripeOperation } from "../../lib/stripe-retry";

test("retryAsync retries transient failures and succeeds", async () => {
  let attempts = 0;

  const value = await retryAsync(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("transient");
      }
      return "ok";
    },
    {
      maxRetries: 3,
      baseDelayMs: 10,
      maxDelayMs: 10,
      jitterMs: 0
    }
  );

  expect(value).toBe("ok");
  expect(attempts).toBe(3);
});

test("retryAsync respects shouldRetry guard", async () => {
  let attempts = 0;
  await expect(
    retryAsync(
      async () => {
        attempts += 1;
        throw new Error("do-not-retry");
      },
      {
        maxRetries: 5,
        baseDelayMs: 10,
        maxDelayMs: 10,
        jitterMs: 0,
        shouldRetry: () => false
      }
    )
  ).rejects.toThrow("do-not-retry");
  expect(attempts).toBe(1);
});

test("stripe retry helpers classify retryable failures", async () => {
  expect(isRetryableStripeError({ statusCode: 503 })).toBeTruthy();
  expect(isRetryableStripeError({ type: "StripeRateLimitError" })).toBeTruthy();
  expect(isRetryableStripeError({ code: "ECONNRESET" })).toBeTruthy();
  expect(isRetryableStripeError({ statusCode: 400, type: "StripeInvalidRequestError" })).toBeFalsy();

  let attempts = 0;
  const result = await retryStripeOperation(
    "test.op",
    async () => {
      attempts += 1;
      if (attempts < 3) {
        const err = new Error("retry me") as Error & { statusCode?: number };
        err.statusCode = 503;
        throw err;
      }
      return 42;
    },
    {
      maxRetries: 3,
      baseDelayMs: 10,
      maxDelayMs: 10,
      jitterMs: 0
    }
  );

  expect(result).toBe(42);
  expect(attempts).toBe(3);
});
