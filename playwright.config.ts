import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1",
    url: "http://127.0.0.1:3000/api/health",
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL: "postgresql://erp:erp_local_only@127.0.0.1:5432/erp?schema=public",
      DIRECT_URL: "postgresql://erp:erp_local_only@127.0.0.1:5432/erp?schema=public",
      AUTH_SECRET: "e2e-test-secret-with-more-than-thirty-two-characters",
      AUTH_URL: "http://127.0.0.1:3000",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
    },
  },
});
