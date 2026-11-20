import { defineConfig } from "vite";

// 資產路徑一律相對於 index.html：GitHub Pages 無論部署在網域根目錄或
// 專案子路徑（目前為 /kitameet/）都能載入，不需要另外指定部署路徑。
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
  },
});
