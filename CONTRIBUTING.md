# 協作須知

本文件說明 KitaMeet 的開發約定，適用於人類協作者與 AI 代理程式。

## 資料與程式分離

幾何資料一律放在 `src/data/`，渲染與介面程式不得內嵌座標或尺寸。

- 修改現況幾何：改 `src/data/overrides.ts`，或重新執行擷取腳本。
- 修改樓層高程：改 `src/data/schema.ts` 的 `LEVELS`。
- 修改方案幾何：改 `src/data/scenarios/proposal-b.ts` 的參數常數。
- 經緯度與局部座標的換算只能出現在 `src/geo/project.ts`。

新增方案時應沿用 `Scenario` 介面，以 `removed`、`added`、`repurposed` 三組資料描述差異，不另外複製一份現況資料。

## OSM 資料

`src/data/osm/underground.json` 與 `surface.json` 由 `npm run fetch:osm` 產生，不應手動編輯。需要調整擷取範圍或分類規則時，改 `data/queries/*.overpassql` 或 `scripts/fetch-osm.ts` 後重新產生。

產出檔的 `generatedAt` 與 `overpassTimestamp` 會隨每次擷取變動，其餘內容在相同查詢下應完全相同；若座標或分類出現差異，代表上游資料或轉換規則有變，應於提交訊息中說明。

## 資料可信度

每項量體都必須標示 `confidence`：

| 等級 | 使用時機 |
|---|---|
| `sourced` | 出自文獻或官方資料，需同時填寫 `sourceNote` |
| `derived` | 由 OSM 幾何或文獻值計算而得 |
| `estimated` | 本專案推估，應註明推估方式 |

推估值不得在文件或介面中呈現為事實。取得正式圖資後，應將該項改為 `sourced` 並補上來源。

## 文件

`README.md` 與 `docs/` 底下的文件以正體中文撰寫，用字與排版遵循 [`.omp/WRITING_STYLE.md`](./.omp/WRITING_STYLE.md)。各文件的收錄範圍如下，同一項內容只寫在負責的文件中，不跨文件重複：

| 文件 | 收錄 | 不收錄 |
|---|---|---|
| `docs/status-quo.md` | 現況模型的事實、推估值與可信度分級 | 實作方式、變更歷程 |
| `docs/proposals.md` | 方案內容、幾何參數、套合方式與建模限制 | 現況描述、外部來源的細節 |
| `docs/revisions.md` | 方案內容與幾何參數的變更：日期、變更內容與理由 | 受影響的檔案清單、現況模型與算繪的變更、已被後續取代的中間值 |
| `docs/architecture.md` | 資料流、座標系統、資料結構與算繪方式 | 逐項數值與界線細則 |
| `docs/references.md` | 外部資料來源的名稱、網址與採用內容 | 物件代號、逐件清單、本機與專案內的檔案路徑 |

變更方案內容或幾何參數時，須同時於 `docs/revisions.md` 新增一筆紀錄，包含日期、變更內容與理由；受影響的檔案由 git 歷史記錄，不在文件中列出。

## 驗證

提交前至少執行下列兩項：

```sh
npm run test
npm run build
```

涉及渲染或介面的變更，另需以 `npm run dev` 啟動後於瀏覽器確認實際畫面，包含 3D 與空拍兩種視圖。

## 提交訊息

標題為英文祈使句，不超過 72 字元；空一行後以不超過 100 字（複雜變更 200 字）說明變更內容。結尾固定加上：

```
Co-authored-by: Claude <claude@anthropic.com>
```
