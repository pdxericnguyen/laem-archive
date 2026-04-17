import { expect, test, type Page } from "@playwright/test";

async function horizontalWheel(page: Page, direction: "previous" | "next", eventCount = 3) {
  const gallery = page.locator("[data-gallery-viewport]");
  const box = await gallery.boundingBox();
  if (!box) {
    throw new Error("Gallery bounds not available");
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < eventCount; i += 1) {
    await page.mouse.wheel(direction === "next" ? 500 : -500, 0);
    await page.waitForTimeout(16);
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/dev/gallery-sandbox");
  await expect(page.locator("[data-gallery-counter]")).toHaveText("1 / 3");
});

test("desktop arrows move and wrap in both directions", async ({ page }) => {
  await page.getByLabel("Next image").click();
  await expect(page.locator("[data-gallery-counter]")).toHaveText("2 / 3");

  await page.getByLabel("Previous image").click();
  await expect(page.locator("[data-gallery-counter]")).toHaveText("1 / 3");

  await page.getByLabel("Previous image").click();
  await expect(page.locator("[data-gallery-counter]")).toHaveText("3 / 3");

  await page.getByLabel("Next image").click();
  await expect(page.locator("[data-gallery-counter]")).toHaveText("1 / 3");
});

test("desktop horizontal wheel gestures are disabled for launch", async ({ page }) => {
  const startUrl = page.url();

  await horizontalWheel(page, "next", 4);
  await expect(page.locator("[data-gallery-counter]")).toHaveText("1 / 3");

  await page.getByLabel("Next image").click();
  await expect(page.locator("[data-gallery-counter]")).toHaveText("2 / 3");

  await horizontalWheel(page, "previous", 4);
  await expect(page.locator("[data-gallery-counter]")).toHaveText("2 / 3");
  await expect(page).toHaveURL(startUrl);
});
