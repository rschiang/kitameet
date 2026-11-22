# KitaMeet

以實際尺度在 3D 中重建臺北車站及周邊地下結構的單頁互動網站，並可切換至都市更新提案「方案 B」，比較新建、拆除與沿用的範圍。

名稱取自北海道北見市的「北見」（きたみ, Kitami）與「在臺北車站碰面」（meet）的雙關。

## 功能

- 3D 視圖與空拍視圖（正投影俯視、隱藏地面層）兩種呈現方式。
- 以圖層與樓層為單位的顯示開關，地標建物與一般建物可分別控制。
- 現況與方案 B 的切換，並以顏色標示新建、拆除與歸還臺鐵的量體。
- 任意方位的剖面切割。
- 視點、圖層與方案狀態寫入網址，可直接分享特定畫面。

## 開發

需要 Node.js 22 以上。

```sh
npm install
npm run dev      # 本機開發伺服器，預設 http://localhost:5173/
npm run test     # 幾何與資料的單元測試
npm run build    # 型別檢查與正式建置
npm run preview  # 預覽建置結果
```

更新 OpenStreetMap 圖資：

```sh
npm run fetch:osm
```

此指令會重新查詢 Overpass API 並覆寫 `src/data/osm/` 底下的兩份資料檔。網站執行期不連外。

## 文件

| 文件 | 內容 |
|---|---|
| [`docs/status-quo.md`](docs/status-quo.md) | 臺北車站地下結構現況與資料來源分級 |
| [`docs/proposals.md`](docs/proposals.md) | 方案內容、幾何參數與建模限制 |
| [`docs/revisions.md`](docs/revisions.md) | 方案內容與幾何參數的變更紀錄 |
| [`docs/architecture.md`](docs/architecture.md) | 資料流、座標系統、資料結構與算繪方式 |
| [`docs/references.md`](docs/references.md) | 外部資料來源與授權 |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 協作守則與修改規範 |

## 資料來源與授權

本專案以 [GNU AGPL 3.0](LICENSE.md) 自由軟體授權釋出。

幾何資料來自 OpenStreetMap contributors，授權為 ODbL。樓層高程、地下街樓層歸屬與方案位置皆為推估值，詳見各文件中的可信度標示。
