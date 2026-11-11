import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Runs and builds the demo in ./demo against the library source.
export default defineConfig({
  root: "demo",
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "agent-plan-review/styles.css": fileURLToPath(new URL("./src/styles.css", import.meta.url)),
      "agent-plan-review": fileURLToPath(new URL("./src/index.ts", import.meta.url)),
    },
  },
  build: { outDir: "../demo-dist", emptyOutDir: true },
});
