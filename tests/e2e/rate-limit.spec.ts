import { expect, test } from "@playwright/test";

import { deriveRateLimitClientId } from "../../lib/rate-limit";

function buildRequest(headers: Record<string, string>) {
  return new Request("http://localhost:3000/api/test", { headers });
}

test("rate-limit prefers trusted provider headers over x-forwarded-for", () => {
  const request = buildRequest({
    "cf-connecting-ip": "203.0.113.12",
    "x-forwarded-for": "198.51.100.7, 10.0.0.1"
  });
  expect(deriveRateLimitClientId(request)).toBe("203.0.113.12");
});

test("rate-limit ignores x-forwarded-for unless explicitly enabled", () => {
  const prior = process.env.RATE_LIMIT_TRUST_X_FORWARDED_FOR;
  delete process.env.RATE_LIMIT_TRUST_X_FORWARDED_FOR;
  try {
    const request = buildRequest({
      "x-forwarded-for": "198.51.100.7, 10.0.0.1",
      "user-agent": "ua-test",
      "accept-language": "en-US,en;q=0.9"
    });
    expect(deriveRateLimitClientId(request)).toContain("anon:");
  } finally {
    if (prior === undefined) {
      delete process.env.RATE_LIMIT_TRUST_X_FORWARDED_FOR;
    } else {
      process.env.RATE_LIMIT_TRUST_X_FORWARDED_FOR = prior;
    }
  }
});

test("rate-limit can trust x-forwarded-for when explicitly enabled", () => {
  const prior = process.env.RATE_LIMIT_TRUST_X_FORWARDED_FOR;
  process.env.RATE_LIMIT_TRUST_X_FORWARDED_FOR = "true";
  try {
    const request = buildRequest({
      "x-forwarded-for": "198.51.100.7, 10.0.0.1"
    });
    expect(deriveRateLimitClientId(request)).toBe("198.51.100.7");
  } finally {
    if (prior === undefined) {
      delete process.env.RATE_LIMIT_TRUST_X_FORWARDED_FOR;
    } else {
      process.env.RATE_LIMIT_TRUST_X_FORWARDED_FOR = prior;
    }
  }
});
