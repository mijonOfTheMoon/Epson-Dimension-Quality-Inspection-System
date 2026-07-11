import { expect, test } from "@playwright/test";

test("serves the application shell", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBeTruthy();
});

test("renders a document title", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/.+/);
});
