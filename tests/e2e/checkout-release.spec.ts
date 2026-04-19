import { expect, test } from "@playwright/test";

import {
  CHECKOUT_SESSION_COOKIE,
  isAllowedRequestOrigin,
  isCheckoutSessionId,
  readCookieValue,
  shouldEnforceCheckoutOriginGuard
} from "../../lib/checkout-session";

test("checkout release clears cookie when no session exists", async ({ request }) => {
  const response = await request.post("/api/checkout/release");
  expect(response.status()).toBe(200);

  const payload = await response.json();
  expect(payload).toEqual({
    ok: true,
    released: false
  });

  const setCookie = response.headers()["set-cookie"] || "";
  expect(setCookie).toContain(`${CHECKOUT_SESSION_COOKIE}=`);
  expect(setCookie.toLowerCase()).toContain("max-age=0");
});

test("checkout release ignores invalid session cookie", async ({ request }) => {
  const response = await request.post("/api/checkout/release", {
    headers: {
      cookie: `${CHECKOUT_SESSION_COOKIE}=invalid_checkout_cookie`
    }
  });
  expect(response.status()).toBe(200);

  const payload = await response.json();
  expect(payload).toEqual({
    ok: true,
    released: false
  });
});

test("checkout helper utilities enforce origin and session parsing", async () => {
  const encoded = `${CHECKOUT_SESSION_COOKIE}=cs_test_123%2B456; other=1`;
  expect(readCookieValue(encoded, CHECKOUT_SESSION_COOKIE)).toBe("cs_test_123+456");

  expect(isCheckoutSessionId("cs_test_123_456")).toBeTruthy();
  expect(isCheckoutSessionId("not_a_session")).toBeFalsy();

  expect(isAllowedRequestOrigin(null, "https://laemarchive.com")).toBeTruthy();
  expect(isAllowedRequestOrigin("https://laemarchive.com", "https://laemarchive.com")).toBeTruthy();
  expect(isAllowedRequestOrigin("https://attacker.example", "https://laemarchive.com")).toBeFalsy();
  expect(shouldEnforceCheckoutOriginGuard()).toBeFalsy();
});
