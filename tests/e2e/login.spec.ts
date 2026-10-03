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

test("outstanding balances and voucher export require an authenticated company", async ({ request }) => {
  for (const path of ["/api/accounting/reports/outstanding", "/api/accounting/vouchers/export"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(401);
  }
});

test("company management pages require an authenticated session", async ({ page }) => {
  for (const path of [
    "/dashboard/company",
    "/dashboard/users",
    "/dashboard/roles",
    "/dashboard/financial-years",
    "/dashboard/security",
    "/dashboard/audit",
    "/dashboard/parties",
    "/dashboard/ledgers",
    "/dashboard/ledger-groups",
    "/dashboard/accounting-reports",
    "/dashboard/inventory",
    "/dashboard/inventory/item-test",
    "/dashboard/stock-groups",
    "/dashboard/units",
    "/dashboard/warehouses",
    "/dashboard/inventory-reports",
    "/dashboard/vouchers",
    "/dashboard/day-book",
    "/dashboard/tax-transactions",
    "/dashboard/voucher-series",
    "/dashboard/cost-centres",
    "/dashboard/sales",
    "/dashboard/sales-reports",
    "/dashboard/purchases",
    "/dashboard/purchase-reports",
    "/dashboard/sales/sales-test",
    "/dashboard/sales/sales-test/print",
    "/dashboard/vouchers/voucher-test",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
});
