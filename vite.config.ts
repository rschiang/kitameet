import { defineConfig } from "vite";

// GitHub Pages 需要子路徑；由 BASE_PATH 環境變數指定，本機開發預設根路徑。
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
  },
});
