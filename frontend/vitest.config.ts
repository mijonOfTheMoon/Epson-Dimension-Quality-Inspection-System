import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, "./src/lib"),
    },
  },
  test: {
    environment: "node",
    include: [
      "src/**/*.{test,spec}.ts",
      "tests/integration/**/*.{test,spec}.ts",
    ],
  },
});
