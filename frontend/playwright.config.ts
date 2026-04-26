import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

const frontendDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(frontendDirectory, "..");

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4173"
  },
  webServer: {
    command: "npm run dev --workspace @portfolio/frontend",
    cwd: workspaceRoot,
    port: 4173,
    reuseExistingServer: true
  }
});
