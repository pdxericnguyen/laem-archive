import { expect, test, type Page } from "@playwright/test";

async function wheelGesture(page: Page, direction: "previous" | "next", eventCount = 1) {
  const gallery = page.locator("[data-gallery-viewport]");
  const box = await gallery.boundingBox();
  if (!box) {
    throw new Error("Gallery bounds not available");
  }

  const scrollAmount = await gallery.evaluate((element) => element.clientWidth * 0.72);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < eventCount; i += 1) {
    await page.mouse.wheel(direction === "next" ? scrollAmount : -scrollAmount, 0);
    await page.waitForTimeout(16);
  }
}

async function pauseBetweenWheelGestures(page: Page) {
  await page.waitForTimeout(380);
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

test("desktop horizontal wheel gestures snap one image per gesture and wrap at the edges", async ({ page }) => {
  const startUrl = page.url();

  await wheelGesture(page, "next");
  await expect(page.locator("[data-gallery-counter]")).toHaveText("2 / 3");
  await expect(page).toHaveURL(startUrl);

  await pauseBetweenWheelGestures(page);
  await wheelGesture(page, "next", 3);
  await expect(page.locator("[data-gallery-counter]")).toHaveText("3 / 3");
  await page.waitForTimeout(380);
  await expect(page.locator("[data-gallery-counter]")).toHaveText("3 / 3");

  await pauseBetweenWheelGestures(page);
  await wheelGesture(page, "next");
  await expect(page.locator("[data-gallery-counter]")).toHaveText("1 / 3");

  await pauseBetweenWheelGestures(page);
  await wheelGesture(page, "previous");
  await expect(page.locator("[data-gallery-counter]")).toHaveText("3 / 3");
  await expect(page).toHaveURL(startUrl);
});

test("desktop wheel edge behavior works with longer galleries", async ({ page }) => {
  await page.goto("/dev/gallery-sandbox?images=5");
  await expect(page.locator("[data-gallery-counter]")).toHaveText("1 / 5");

  await wheelGesture(page, "next");
  await expect(page.locator("[data-gallery-counter]")).toHaveText("2 / 5");

  await pauseBetweenWheelGestures(page);
  await wheelGesture(page, "next");
  await expect(page.locator("[data-gallery-counter]")).toHaveText("3 / 5");

  await pauseBetweenWheelGestures(page);
  await wheelGesture(page, "next");
  await expect(page.locator("[data-gallery-counter]")).toHaveText("4 / 5");

  await pauseBetweenWheelGestures(page);
  await wheelGesture(page, "next", 3);
  await expect(page.locator("[data-gallery-counter]")).toHaveText("5 / 5");
  await page.waitForTimeout(380);
  await expect(page.locator("[data-gallery-counter]")).toHaveText("5 / 5");

  await pauseBetweenWheelGestures(page);
  await wheelGesture(page, "next");
  await expect(page.locator("[data-gallery-counter]")).toHaveText("1 / 5");
});
