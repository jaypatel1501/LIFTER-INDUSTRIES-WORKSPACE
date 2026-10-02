import { expect, test } from "@playwright/test";

test("sign-in screen offers email and mobile OTP access", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await page.getByRole("tab", { name: "Mobile OTP" }).click();
  await expect(page.getByLabel("Mobile number")).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test("liveness endpoint responds successfully", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBeTruthy();
  await expect(response).toBeOK();
});
