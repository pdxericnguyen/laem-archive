import { expect, test, type Page } from "@playwright/test";

async function wheelGesture(page: Page, deltaX: number, eventCount = 10, gapMs = 10) {
  const gallery = page.getByLabel(/gallery test piece gallery/i);
  for (let i = 0; i < eventCount; i += 1) {
    await gallery.dispatchEvent("wheel", { deltaX, deltaY: 0 });
    await page.waitForTimeout(gapMs);
  }
}

async function wheelLull(page: Page) {
  await wheelGesture(page, 1, 3, 4);
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

test("desktop wheel gestures advance one image per gesture and wrap", async ({ page }) => {
  const startUrl = page.url();

  await wheelGesture(page, 7, 12, 8);
  await expect(page.getByAltText("Gallery test piece image 2")).toBeVisible();
  await expect(page).toHaveURL(startUrl);

  await wheelGesture(page, 7, 12, 8);
  await expect(page.getByAltText("Gallery test piece image 2")).toBeVisible();

  await wheelLull(page);
  await wheelGesture(page, 7, 12, 8);
  await expect(page.getByAltText("Gallery test piece image 3")).toBeVisible();

  await wheelLull(page);
  await wheelGesture(page, 7, 12, 8);
  await expect(page.getByAltText("Gallery test piece image 1")).toBeVisible();

  await expect(page).toHaveURL(startUrl);
});
