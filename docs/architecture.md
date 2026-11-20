# 架構

本文件說明 KitaMeet 的資料流、座標系統、資料結構與渲染方式，供後續維護與資料更新時參考。

## 資料流

```mermaid
graph TD
    overpass["Overpass API"] -- "overpassql 查詢" --> fetch["scripts/fetch-osm.ts"]
    fetch -- "局部公尺座標 JSON" --> osm["src/data/osm/*.json"]
    dortspdf["捷運局禁限建公告圖 PDF"] -- "向量解析、圖幅定位" --> fetchd["scripts/fetch-dorts.ts"]
    fetchd -- "局部公尺座標 JSON" --> dorts["src/data/dorts/*.json"]
    osm --> scene["src/data/scene.ts<br/>buildBaseline()"]
    dorts --> dortsmod["src/data/dorts.ts<br/>buildDorts()"]
    dortsmod --> scene
    overrides["src/data/overrides.ts<br/>文獻覆寫"] --> scene
    levels["src/data/levels.ts<br/>構造物樓層表"] --> scene
    structures["src/data/structures/station-complex.ts<br/>分層地下構造"] --> scene
    scene --> scenario["src/app/scenario.ts<br/>方案疊圖"]
    proposal["src/data/scenarios/proposal-b.ts"] --> scenario
    scenario --> builders["src/render/builders.ts<br/>量體建模"]
    builders --> viewer["src/render/scene.ts<br/>three.js 場景"]
```

擷取與渲染完全分離：`npm run fetch:osm` 與 `npm run fetch:dorts` 僅在需要更新圖資時執行，網站執行期不連外。產出的 `src/data/osm/underground.json` 與 `surface.json` 進版控，目前分別為 192 與 2294 項量體；`src/data/dorts/structures.json` 與 `basemap.json` 亦進版控，PDF 快取則留在 `data/cache/dorts/`，不進版控。

## 座標系統

- 專案原點為 WGS84 的 25.0478° N、121.5172° E，位於臺北車站站體中心附近。
- 投影採 EPSG:3826（TWD97 TM2，中央經線 121 度），減去原點的 TM2 座標後得局部公尺座標，x 為東、y 為北。
- three.js 場景座標為 X = x、Y = 高程、Z = −y，維持右手座標系。
- 經緯度換算只出現在 `src/geo/project.ts`；渲染端一律使用局部公尺座標。

擷取範圍分為兩組：地下結構為 25.0400–25.0580° N、121.5050–121.5330° E；地面建物為 25.0440–25.0530° N、121.5090–121.5250° E。兩組範圍定義於 `data/queries/*.overpassql` 的 `[bbox:…]` 設定，腳本由查詢檔讀取後寫入產出檔的檔頭。

## 樓層標籤與構造物深度

`LevelId`（`elevated`、`G`、`B1`–`B4`）只是樓層標籤，不代表深度：臺鐵高鐵站體的 B2 為月台層、深度 −14.5 公尺，捷運台北車站的 B2 為板南線大廳層、深度 −11.0 公尺。

實際深度由 `src/data/levels.ts` 的 `STRUCTURES` 決定，每個構造物各有一份 `floor`（樓板高程）與 `height`（淨高）的樓層表，另記結構底高程。`levelOf(structure, level)` 為唯一查詢入口；構造物未指定、或該構造物沒有這一層時回退 `src/data/schema.ts` 的預設樓層表，不拋出例外。

| 代號 | 名稱 | 預設樓板高程 | 預設層高 |
|---|---|---|---|
| `elevated` | 高架層 | 8.0 公尺 | 9.0 公尺 |
| `G` | 地面層 | 0 | 7.0 公尺 |
| `B1` | 地下一層 | −7.0 公尺 | 6.0 公尺 |
| `B2` | 地下二層 | −14.5 公尺 | 7.5 公尺 |
| `B3` | 地下三層 | −22.0 公尺 | 7.5 公尺 |
| `B4` | 地下四層 | −29.5 公尺 | 7.5 公尺 |

結構樓板面即軌道面，以 `railLevelOf(structure, level)` 取得；月台自樓板再長高 1.1 公尺。另有 `levelLabelFor(elevation)` 依高程取最接近的預設樓層標籤，供不屬於任何構造物的量體（公告圖隧道、路線正線）決定圖層面板的樓層開關。各構造物的實際深度列於 `docs/status-quo.md`。

## 分層地下構造

OSM 只有 2D 輪廓，捷運台北車站與機場捷運 A1 站各只有單一巨大多邊形。兩者於覆寫表標為 `exclude`，改由 `src/data/structures/station-complex.ts` 的 `buildStationComplex()` 產生分層量體，於 `buildBaseline()` 併入場景：站體的逐層樓板、B1 的五條南北向通道與南北迴廊、捷運兩線的樓板與大廳、垂直動線核心、A1 的樓板、大廳與地下量體，以及地下街之間的連通道。

臺鐵高鐵站體與 A1 的平面由 OSM 輪廓推算（`polygonAxis`、`advance`、`offsetPolyline`、`corridorPolygon`、`nearestPair`）；捷運兩線的平面則取自公告圖的車站箱涵——以含 OSM 月台形心者為準，找不到即擲出例外。深度一律取該構造物的樓層表，不新增座標常數。

## 禁限建公告圖

`npm run fetch:dorts` 自捷運局的查詢系統取得逐幅向量 PDF，解析為局部公尺座標的 JSON。流程分為四步，各有獨立模組：

| 模組 | 作用 |
|---|---|
| `scripts/dorts/pdf.ts` | 以 `node:zlib` 解開內容流，解析 PDF 路徑運算子與圖層標記，輸出帶圖層名的向量路徑 |
| `scripts/dorts/georef.ts` | 以 50 公尺 TWD67 方格網求比例與方向、以指北針定北，再以格網落在 50 公尺整數倍的條件校正平移 |
| `scripts/dorts/layers.ts` | 依圖層名分為結構外緣、限建線、軌道中心線、建物與道路五類 |
| `scripts/dorts/structures.ts`、`basemap.ts` | 沿軌道中心線量測淨寬切出潛盾與箱形段；地形圖的建物線段以平面圖解析求面 |

旋轉角一律由格網與指北針決定，不可改用圖框四角的最小平方套合：矩形有 180 度旋轉對稱，四角對應有兩組殘差同為零的解，會使部分圖幅整幅翻轉。比例亦逐幅自格網求取，`SA01RWSS02A` 的圖面比例與其餘圖幅相差 5.8%，以相鄰圖幅的建物吻合度（中位數 0.03 公尺）證實。

腳本結束前輸出品質報告，格網殘差、格網校正量、相鄰圖幅建物吻合度與「限建線距結構外緣 50 公尺」任一項超出門檻即以非零狀態結束，不寫出產出檔。

涵蓋範圍內的平面幾何一律以公告圖為準：建物面取代比對到的 OSM 建物並承接其高度與名稱、軌道中心線取代 OSM 捷運正線；範圍外與無對應者維持 OSM。公告圖的道路邊線為路緣線，與 OSM 的半透明路面並存，不互相取代。隧道與軌道中心線先去重（某條折線 90% 以上的頂點落在另一條 1.5 公尺內即捨棄較短者），避免相鄰圖幅與鄰線參考畫法使同一條結構以兩種顏色、兩種深度重複繪出。所屬路線以幾何判定（頂點到 OSM 有 `ref` 正線的距離中位數最小且不超過 25 公尺），無命中才回退圖幅代號：圖幅會將鄰線結構當作參考一併繪出，僅靠圖幅代號會將鄰線結構塗成自己的顏色。深度則全為推估，由 `levels.ts` 的 `METRO_LINES` 給出各路線軌道面高程，潛盾段軸心取 `rail + 1.5`、箱涵底取 `rail − 1.5`。

## 量體結構

渲染端唯一認得的資料結構為 `Feature`：

| 欄位 | 說明 |
|---|---|
| `id` | OSM id（如 `way/584167409`）、公告圖識別字串（如 `dorts/N/bore/3`）或方案量體的識別字串 |
| `level` | 所屬樓層標籤 |
| `structure` | 所屬構造物，決定該樓層標籤對應的實際深度 |
| `layer` | 圖層代號，亦為圖層面板的開關單位 |
| `line` | 所屬系統或路線（`tra`、`hsr`、`bl`、`r`、`g`、`o`、`a`），決定著色 |
| `base`、`baseEnd`、`height`、`width`、`radius` | 底面高程、折線末端的底面高程（傾斜量體）、高度、折線量體寬度、圓形隧道半徑 |
| `confidence` | `sourced`、`derived` 或 `estimated` |
| `sourceNote` | 資料依據或推估方式 |
| `status` | `existing`、`added`、`removed` 或 `repurposed` |

`confidence` 的三級定義為：`sourced` 出自文獻或官方資料並附來源、`derived` 由 OSM 幾何或文獻值計算而得、`estimated` 為本專案推估。

圖層共 11 組：地標建物、一般建物、高架道路、道路、車站量體、月台、股道、地下街、捷運、通道、禁限建範圍。地標與一般建物分屬不同圖層，可單獨關閉周邊街廓而保留地標；禁限建範圍會蓋住整個畫面，預設關閉。

## 渲染

多邊形以 `ExtrudeGeometry` 長出高度，折線先由中心線往兩側平移成封閉帶狀再長出厚度，圓形隧道則以 `CatmullRomCurve3` 搭配 `TubeGeometry` 沿軸心掃出，三者都在建模時將高程烘焙進頂點。

折線量體指定 `baseEnd` 且與 `base` 不同時改以 `slopedBand()` 建模：左右緣各取一次平移，沿累積弧長線性內插兩端高程後才各自放大，再組出上下面、側面與端面。引道、匝道與疊式隧道的收斂段藉此連續呈現，不致出現段差。

地下高程於建模時放大 1.2 倍，使各層的相對關係在畫面上分辨得出。放大只作用於負高程，單一入口為 `src/render/depth.ts` 的 `exaggerate()`，於 `buildFeatureMesh` 中套用於量體的上下兩端高程、高度取兩端之差，資料層一律保存真實高程。

圓形隧道的放大只作用於軸心高程，半徑維持真實值，否則隧道會被壓成與斷面不符的扁管。

紙模型色調以 `MeshStandardMaterial` 為底（`roughness` 0.95、`metalness` 0），於 `onBeforeCompile` 注入菲涅耳邊緣提亮與極淡的垂直漸層，不加描邊。著色優先序為方案狀態、所屬路線（`LINE_COLORS`，取自維基百科 Template:台北捷運色彩並與底色混色降彩度）、量體類型、圖層。車站量體與樓板以半透明呈現，外殼僅繪製背面，使內部的月台與股道不致遭到遮蔽；樓板與外殼另設 `polygonOffset` 退讓給貼在其上的量體，避免共面造成閃爍。道路為半透明路面，公告圖的路緣線疊於其上。光照為半球光加單一平行光，色調映射採 ACES Filmic。

## 視圖模式

- **3D**：透視相機，`OrbitControls` 操作，地面以半透明紙面呈現，可透視地下結構。
- **空拍**：正投影相機、固定正俯視，隱藏地面以上的圖層與地面，量體沿高程壓縮為薄板並依樓層分層排列，各層轉為半透明以免互相遮蔽。

於空拍模式拖曳旋轉使相機極角超過 2 度時自動切回 3D，並保留當前的視點與目標；縮放與平移不觸發切換。由網址還原狀態時，空拍模式的視點一律拉回目標正上方，避免帶入非俯視的視點後立即觸發切換。

## 剖面

單一 `THREE.Plane` 套用至所有材質的 `clippingPlanes`，方位角以正東為 0 度、逆時針為正，位置為剖切面沿法線方向距原點的公尺數（−800 至 800）。材質的 `side` 為 `DoubleSide`，斷面可見內部結構。

## 永久連結

狀態序列化於 `location.hash`，以 `history.replaceState` 更新，不留下大量瀏覽歷史。

| 參數 | 內容 |
|---|---|
| `v` | 格式版本，目前為 `1` |
| `m` | 視圖模式，`3d` 或 `aerial` |
| `s` | 方案，`status-quo` 或 `proposal-b` |
| `loff` | 關閉的圖層代號，以逗號分隔（僅記錄預設開啟者） |
| `lon` | 開啟的圖層代號，以逗號分隔（僅記錄預設關閉者，目前為禁限建範圍） |
| `voff` | 關閉的樓層代號，以逗號分隔 |
| `sec` | 剖面的方位角與位置，僅在啟用時出現 |
| `cam` | 相機位置、目標與縮放，共 7 個數值 |

版本不符或參數缺漏時一律回到預設值，不拋出例外。

## 部署

`npm run build` 先以 `tsc --noEmit` 檢查型別，再由 Vite 建置至 `dist/`。`vite.config.ts` 的 `base` 固定為 `./`，產出的資產路徑相對於 `index.html`，部署在網域根目錄或專案子路徑皆可載入。

`.github/workflows/pages.yml` 於推送至 `main` 時執行測試與建置，再以 `actions/upload-pages-artifact` 與 `actions/deploy-pages` 發布至 GitHub Pages。網站路徑為相對路徑，更名儲存庫或改掛網域根目錄都不需要調整建置設定。
