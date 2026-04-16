import { expect, test, type Page } from "@playwright/test";

async function wheelBurst(page: Page, deltaX: number, count: number, gapMs = 12) {
  const gallery = page.getByLabel(/gallery test piece gallery/i);
  for (let i = 0; i < count; i += 1) {
    await gallery.dispatchEvent("wheel", { deltaX, deltaY: 0 });
    await page.waitForTimeout(gapMs);
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/dev/gallery-sandbox");
  await expect(page.getByAltText("Gallery test piece image 1")).toBeVisible();
});

test("desktop arrows move and wrap in both directions", async ({ page }) => {
  await page.getByLabel("Next image").click();
  await expect(page.getByAltText("Gallery test piece image 2")).toBeVisible();

  await page.getByLabel("Previous image").click();
  await expect(page.getByAltText("Gallery test piece image 1")).toBeVisible();

  await page.getByLabel("Previous image").click();
  await expect(page.getByAltText("Gallery test piece image 3")).toBeVisible();

  await page.getByLabel("Next image").click();
  await expect(page.getByAltText("Gallery test piece image 1")).toBeVisible();
});

test("single horizontal wheel gesture advances one image and keeps url stable", async ({ page }) => {
  const startUrl = page.url();

  await wheelBurst(page, 6, 6, 10);
  await expect(page.getByAltText("Gallery test piece image 2")).toBeVisible();
  await expect(page).toHaveURL(startUrl);

  await wheelBurst(page, 6, 6, 10);
  await expect(page.getByAltText("Gallery test piece image 2")).toBeVisible();

  await page.waitForTimeout(180);
  await wheelBurst(page, 6, 6, 10);
  await expect(page.getByAltText("Gallery test piece image 3")).toBeVisible();
  await expect(page).toHaveURL(startUrl);
});
