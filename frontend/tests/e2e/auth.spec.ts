import { expect, test } from "@playwright/test";

test.describe("authentication gate", () => {
  test("renders the DimInspect login form", async ({ page }) => {
    await page.goto("/login");

    await expect(page).toHaveTitle("DimInspect");
    await expect(page.getByRole("heading", { name: "Masuk ke Sistem" })).toBeVisible();
    await expect(page.locator("#login-username")).toBeVisible();
    await expect(page.locator("#login-password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Masuk" })).toBeVisible();
  });

  test("toggles password visibility", async ({ page }) => {
    await page.goto("/login");

    const password = page.locator("#login-password");
    const toggle = page.locator('form button[type="button"]');

    await expect(password).toHaveAttribute("type", "password");
    await toggle.click();
    await expect(password).toHaveAttribute("type", "text");
    await toggle.click();
    await expect(password).toHaveAttribute("type", "password");
  });

  test("redirects unauthenticated visitors to the login page", async ({ page }) => {
    await page.goto("/");

    await page.waitForURL("**/login");
    await expect(page.getByRole("heading", { name: "Masuk ke Sistem" })).toBeVisible();
  });
});
