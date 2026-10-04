import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1" },
  clearMocks: true,
  testTimeout: 30_000,
  collectCoverageFrom: ["lib/**/*.ts", "!lib/prisma.ts"],
};

export default config;
