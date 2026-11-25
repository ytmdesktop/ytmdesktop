import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/system",
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [["list"]],
});
