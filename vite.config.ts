/// <reference types="vitest/config" />
import { defineConfig } from "vite";

// 資產路徑一律相對於 index.html：GitHub Pages 無論部署在網域根目錄或
// 專案子路徑（目前為 /kitameet/）都能載入，不需要另外指定部署路徑。
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
  },
  test: {
    // 同一 worker 的測試檔共用模組快取：現況與方案場景每個 worker 只建一次。
    // 測試不得就地修改 buildBaseline()、featuresFor() 回傳的量體，否則會影響同一 worker 的其他測試檔。
    isolate: false,
    setupFiles: ["tests/setup.ts"],
  },
});
