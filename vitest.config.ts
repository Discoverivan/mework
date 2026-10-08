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
    globals: true,
    setupFiles: ["./frontend/test/setup.ts"],
  },
});
