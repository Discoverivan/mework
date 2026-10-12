import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./frontend"),
    },
  },
  test: {
    environment: "jsdom",
    // Bound concurrent DOM environments so CI and local smoke checks use the same budget.
    maxWorkers: 2,
    globals: true,
    setupFiles: ["./frontend/test/setup.ts"],
  },
});
