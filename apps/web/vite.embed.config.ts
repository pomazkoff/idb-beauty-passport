/** Сборка web-компонента <idb-beauty-quiz> (ТЗ 8.1): один файл, ESM + IIFE, CSS внутри Shadow DOM. */
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  // Для встраиваемого бандла React заменяется на preact/compat — тот же код, ~40 KB gzip меньше (ТЗ 8.4: ≤ 60 KB).
  resolve: {
    alias: {
      react: "preact/compat",
      "react-dom/client": "preact/compat/client",
      "react-dom": "preact/compat",
      "react/jsx-runtime": "preact/jsx-runtime",
    },
  },
  build: {
    outDir: "dist/embed",
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, "src/embed.tsx"),
      name: "IdbBeautyQuiz",
      formats: ["es", "iife"],
      fileName: (f) => (f === "es" ? "idb-beauty-quiz.js" : "idb-beauty-quiz.iife.js"),
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
    cssCodeSplit: false,
  },
});
