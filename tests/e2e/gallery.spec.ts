import { expect, test, type Page } from "@playwright/test";

async function dragHorizontally(page: Page, deltaX: number) {
  const gallery = page.getByLabel(/gallery test piece gallery/i);
  const box = await gallery.boundingBox();
  if (!box) {
    throw new Error("Gallery bounds not available");
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const endX = startX + deltaX;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, startY, { steps: 10 });
  await page.mouse.up();
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

test("desktop drag gesture advances one image at a time and keeps url stable", async ({ page }) => {
  const startUrl = page.url();

  await dragHorizontally(page, -110);
  await expect(page.getByAltText("Gallery test piece image 2")).toBeVisible();
  await expect(page).toHaveURL(startUrl);

  await dragHorizontally(page, -110);
  await expect(page.getByAltText("Gallery test piece image 3")).toBeVisible();
  await expect(page).toHaveURL(startUrl);
});
