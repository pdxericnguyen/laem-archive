import { expect, test } from "@playwright/test";

import {
  getAdminFilterCountClass,
  getAdminFilterTabClass,
  getAdminQueueButtonClass
} from "../../lib/admin-ui";

test("admin filter tabs keep black active treatment", () => {
  expect(getAdminFilterTabClass(true)).toContain("border-neutral-900");
  expect(getAdminFilterTabClass(true)).toContain("bg-neutral-900");
  expect(getAdminFilterTabClass(true)).toContain("text-white");

  expect(getAdminFilterTabClass(false)).toContain("border-neutral-300");
  expect(getAdminFilterTabClass(false)).toContain("hover:bg-neutral-50");
});

test("admin filter count bubble keeps active/inactive contrast", () => {
  expect(getAdminFilterCountClass(true)).toBe("bg-white/15 text-white");
  expect(getAdminFilterCountClass(false)).toBe("bg-neutral-100 text-neutral-600");
});

test("admin queue buttons keep black active state", () => {
  const active = getAdminQueueButtonClass(true);
  const inactive = getAdminQueueButtonClass(false);

  expect(active).toContain("border-neutral-900");
  expect(active).toContain("bg-neutral-900");
  expect(active).toContain("text-white");

  expect(inactive).toContain("border-neutral-300");
  expect(inactive).toContain("hover:bg-neutral-50");
});
