import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    restoreMocks: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    server: {
      deps: {
        // salient-ui's dist uses extensionless relative imports, which Node's
        // ESM resolver rejects. Inlining the package routes it through Vite's
        // resolver instead, the same way webpack handles it in the app build.
        //
        // Scoped to salient-UI deliberately: salient-auth resolves fine on its
        // own, and inlining it makes Vite read .js.map files whose `sources`
        // the package does not publish, printing a screen of "points to
        // missing source files" warnings on every run.
        inline: [/@journey-further\/salient-ui/],
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
