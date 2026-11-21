# 變更紀錄

逐筆記錄提案與模型的變更。每筆包含日期、變更內容、理由與受影響的資料檔；修改提案幾何時應同步新增一筆。

## 2026-11-20：方案 B 初版（依 B′ 示意圖建模）

**變更內容**

- 依研究小組的「方案 B′」示意圖建立方案 B：拆除 K 區地下街與其停車場，新建長 410 公尺的高鐵島式月台 甲、乙，第 1、2 月台歸還臺鐵。
- 新建股道東端採最小半徑 122 公尺、西端採最小半徑 82 公尺，緩和曲線長度取 0.5 倍半徑。
- 於 B2 增設南北向轉乘通道。

**理由**

示意圖為本專案目前唯一的方案來源，幾何參數取其圖面量測值。

**受影響的資料檔**

- `src/data/scenarios/proposal-b.ts`
- `docs/assets/proposal-b-reference.png`

## 2026-11-20：新月台位移量由 28／52 調整為 38／62 公尺

**變更內容**

甲、乙月台中心線相對既有第 1 月台的南移量由 28、52 公尺改為 38、62 公尺，兩者間距維持 24 公尺。

**理由**

月台主軸傾斜約 10.5 度，兩座 410 公尺月台合計佔去約 111 公尺的南北向範圍，大於 K 區地下街輪廓的 104 公尺帶寬。原值使甲月台西端北側超出 K 區範圍約 13 公尺；調整後南北兩端的超出量相等，各約 3 公尺。

**受影響的資料檔**

- `src/data/scenarios/proposal-b.ts`（`PLATFORM_OFFSETS`）

## 2026-11-20：現況模型的樓層高程與地下街樓層歸屬

**變更內容**

- 建立樓層高程表：B1 為 −7.0、B2 月台面為 −14.5、B3 為 −22.0、B4 為 −29.5 公尺。
- 地下街統一歸入 B1、K 區停車場歸入 B2，不採用 OSM 的 `level` 標籤。
- 臺北車站站體高度由 OSM 的 30 公尺改為文獻值 48 公尺、樓層數由 7 改為 6。

**理由**

OSM 的 `level` 標法與市府及營運單位的樓層稱呼不一致，站體的高度標籤亦與文獻不符。樓層高程無公開圖資可循，先以一般鐵路車站層高推估，全數標為 `estimated`。

**受影響的資料檔**

- `src/data/schema.ts`（`LEVELS`）
- `src/data/overrides.ts`

## 2026-11-20：地下構造分層化與構造物樓層表

**變更內容**

- 新增 `src/data/levels.ts`：每個地下構造物各有一份樓層表（樓板高程與淨高）與結構底高程，樓層代號降為標籤。`src/data/schema.ts` 的 `LEVELS` 改為僅供未指定構造物的量體使用的預設表。
- 捷運台北車站與機場捷運 A1 站的單一 OSM 輪廓改為排除，改由 `src/data/structures/station-complex.ts` 產生分層量體：逐層樓板、大廳、月台、股道、通道、垂直動線與地下街連通道。
- 地下高程於建模時放大 1.2 倍，單一入口為 `src/render/depth.ts`。

**理由**

OSM 只有 2D 輪廓，捷運台北車站因而只能以單一巨塊呈現，無法表現站區的多層結構。樓層代號亦不足以表示深度：同樣標為 B2 的樓層，臺鐵高鐵月台層位於 −14.5 公尺、捷運板南線大廳層位於 −11.0 公尺。機場捷運 A1 車站的開挖深度 27.1 公尺與各層用途取自捷運局文獻，其餘高程為推估。

**受影響的資料檔**

- `src/data/levels.ts`、`src/data/structures/station-complex.ts`（新增）
- `src/data/schema.ts`、`src/data/overrides.ts`、`src/data/scene.ts`
- `src/render/depth.ts`、`src/render/builders.ts`

## 2026-11-20：方案 B 的改建區間改以延平北路為西界

**變更內容**

- 新增 `REBUILD_ZONE`：改建區間自延平北路一段東側（局部座標 x −524）至中山北路一段東側（x 460）。新建股道不再以既有喉管節點為終點，改為延伸至該區間的界線。
- 區間內的既有高鐵隧道（`way/13991375`、`way/323105864`、`way/381111230`、`way/593866771`）切為兩截，區間內的部分標為拆除重建。
- `docs/proposals.md` 刪除「新建股道的接軌點落在既有喉管之外」的限制敘述。

**理由**

方案 B 原本即包含自延平北路以東改建高鐵隧道，先前的模型只將新建股道接至既有喉管（約在重慶北路），因而將提案範圍內的延伸誤判為超出既有喉管的限制。西界取延平北路是因其西側為機場捷運 A1 車站與 C1、D1 聯開大樓的共構基地（地下四層、開挖深度約 27.1 公尺），已無改建空間。東界 460 公尺依示意圖估算。

**受影響的資料檔**

- `src/data/scenarios/proposal-b.ts`（`REBUILD_ZONE`、`connector()`）
- `src/app/scenario.ts`、`src/geo/offset.ts`（`splitPolylineAtX`）
- `docs/proposals.md`

## 2026-11-20：方案 B 幾何對齊正本 B′ 疊圖

**變更內容**

- 甲、乙月台中心線的南移量由 38／62 公尺改為 51.0／72.0 公尺，兩島中心間距由 24.0 公尺改為 21.0 公尺。
- 新月台東端改以 K 區地下街（`way/450732441`）東端定位，不再取既有第 1 月台的東端。
- 改建區間改為 x −589（延平北路一帶）至 x 316（中山北路一段下方）。兩端的接軌點改取既有高鐵股道與界線的交點：甲月台接 `way/13991375`、`way/381111230`，乙月台接 `way/323105864`、`way/593866771`，不再使用寫死的路廊取樣點。
- 西側反向曲線的標稱最小半徑由 82 公尺改為 122 公尺，與東側相同；個別股道可縮小半徑以在界線前收攏，下限 100 公尺，實際最小為 115.0 公尺。東側取消正本在月台東端外的切線段，西側保留 10 公尺。
- 新增以折線為界的切割（`src/geo/clip.ts`）與開挖侵入清單（`Scenario.encroached`）：站前地下街北側三處出入口（合計 273 平方公尺）與兩段通道落在新建工程的平面包絡內，標為拆除重建，地下街主體 9851 平方公尺保留且仍為單一連通量體。
- 機場捷運 A1 的月台改採 OSM `way/871105041`、`way/871105042`（原無 `level` 標籤，覆寫為 B3），刪除合成的 `a1/platform` 與 `a1/track/*`；進站段與機廠線六條 way 一併覆寫為 B3。

**理由**

取得研究小組的正本輸出《臺北車站方案 B′ 軌道配置構想》疊圖後，幾何改以該疊圖為準，不再逐項推估。偏離正本之處有三項：月台寬度維持 12 公尺（既有月台過窄為改建動機之一），因而放寬兩島間距；為維持全線最小半徑不低於 100 公尺，西側曲線較正本平緩；為在東界前收攏，取消正本的東側切線段。A1 月台則因正本即描自同一組 OSM 圖徵，改為直接採用。

**受影響的資料檔**

- `src/data/scenarios/proposal-b.ts`（`PLATFORM_OFFSETS`、`REBUILD_ZONE`、`WEST_RADIUS`、`newPlatformEast()`、`tieIn()`、`connector()`）
- `src/geo/clip.ts`（新增）、`src/geo/offset.ts`（`polylineCrossingAtX`）、`src/app/scenario.ts`
- `src/data/overrides.ts`、`src/data/structures/station-complex.ts`
- `docs/proposals.md`、`docs/references.md`、`docs/status-quo.md`、`docs/architecture.md`

## 2026-11-21：匯入捷運禁限建範圍公告圖，重建地下結構與地形底圖

**變更內容**

- 新增 `npm run fetch:dorts`：自臺北市捷運工程局的禁限建範圍公告圖查詢系統取得 35 幅向量 PDF，解析為局部公尺座標的 JSON。涵蓋南港線、板橋線、淡水線、新店線與松山線，產出 39 段潛盾隧道、14 段箱涵、36 條軌道中心線、599 條限建線、3,999 棟建物與 1,358 條道路邊線。
- 捷運正線與車站改以公告圖的結構外緣量體化：沿軌道中心線每 4 公尺取樣、向兩側投射法線射線量出淨寬，淨寬不大於 8 公尺者建為圓形隧道（半徑 2.6–2.9 公尺），其餘建為箱形量體。原本以 OSM 月台主軸推算的兩臂與轉乘節點方塊一併刪除，站區分層構造的平面改用公告圖的車站箱涵。
- 涵蓋範圍內的平面幾何改以公告圖為準：建物面取代比對到的 OSM 建物並承接其高度與名稱（776 棟）、道路邊線取代 OSM 道路中心線（137 條）、軌道中心線取代 OSM 捷運正線（33 條）。範圍外與無對應者維持 OSM，場景不會出現空洞。
- 新增「禁限建範圍」圖層（預設關閉）與 `tube` 幾何（圓形隧道）；永久連結新增 `lon` 參數，否則預設關閉的圖層一旦開啟便無法分享。
- 新增共用幾何工具 `src/geo/chain.ts`（線段串接與去重）、`polygonize.ts`（平面圖解析求面）、`corridor.ts`（廊帶量測）。

**理由**

公告圖的精度遠高於 OSM：相鄰圖幅同一棟建物吻合至 0.03 公尺，與 OSM 建物的最近邊距中位數則為 1.8–2.4 公尺。捷運結構原以月台主軸推算的矩形兩臂無法呈現潛盾與明挖的差異，也無法呈現站體箱涵的實際輪廓。限建線距結構外緣 50 公尺的特性另可作為套合驗算，實測中位數 49.90 公尺。

各路線的軌道面高程仍為推估：板南線 −17.6 公尺、淡水信義線 −24.6 公尺沿用捷運台北車站月台層，松山新店線 −22.0 公尺為推估值，集中於 `levels.ts` 的 `METRO_LINES`，取得縱剖面圖後只需修改該處。

**受影響的資料檔**

- `scripts/fetch-dorts.ts`、`scripts/dorts/*`（新增）
- `src/data/dorts/structures.json`、`src/data/dorts/basemap.json`（新增）
- `src/data/dorts.ts`、`src/data/dorts-types.ts`（新增）、`src/data/scene.ts`、`src/data/levels.ts`、`src/data/schema.ts`
- `src/data/structures/station-complex.ts`（捷運兩臂改為公告圖箱涵）
- `src/geo/chain.ts`、`src/geo/polygonize.ts`、`src/geo/corridor.ts`（新增）、`src/geo/measure.ts`、`src/geo/project.ts`
- `src/render/builders.ts`、`src/render/palette.ts`、`src/app/state.ts`、`src/app/permalink.ts`、`src/app/panels.ts`
- `docs/architecture.md`、`docs/references.md`

## 2026-11-21：軌道深度改由系統與路線決定，量體呈現修正

**變更內容**

- 軌道深度不再採用 OSM 的 `level`／`layer`：臺鐵、高鐵一律置於站體 B2 月台層，捷運依 `ref` 標籤取 `METRO_LINES` 的路線軌道面，無 `ref` 的橫渡線、側線與機廠線以幾何判定所屬路線（頂點到有 `ref` 正線的距離中位數最小且不超過 40 公尺）。原本因 `layer=-3` 而落到 B3、浮在主線下方 6 公尺的高鐵橫渡線，以及因 −2、−3、−5 三種標籤而分散到三層的松山新店線西門至北門段，因此恢復為連續的同一條路線。
- 樓層基準改為「結構樓板面即軌道面」，月台自樓板長高 1.1 公尺。原先 `railLevelOf()` 回傳樓板減 1.1 公尺，等於將股道埋入樓板，月台頂面與樓板頂面因此共面而互相閃爍。隨之將板南線軌道面由 −17.6 改為 −16.5、淡水信義線由 −24.6 改為 −23.5，與各自月台層的樓板面一致。
- 新增 `Feature.line`（`tra`、`hsr`、`bl`、`r`、`g`、`o`、`a`）與 `LINE_COLORS`：捷運依路線色、臺鐵深藍、高鐵橘，色票取自維基百科 Template:台北捷運色彩並與紙模型底色混色降彩度。圖例改列各路線。
- 新增 `Feature.baseEnd` 與 `slopedBand()`：華山引道自 B2 月台層連續爬升至地面、北門至西門疊式潛盾的下層在北門站收斂回上層、市民大道匝道自橋面斜降至地面。匝道高程以路網拓樸求得（與高架主線共節點者為橋面端、與地面道路共節點者為落地端，其餘沿匝道鏈內插），切成數段的同一條匝道因此不會出現段差。
- 公告圖的潛盾隧道與軌道中心線去重（去掉 12 段隧道與 8 條中心線），所屬路線改以幾何判定，樓層標籤改由 `levelLabelFor()` 依深度給出；道路邊線改為獨立的 `road-edge` 類型，與 OSM 路面並存。
- 建物高度：雨棚、通風井等附屬構造不再以 4 層推估（雨棚改為架高的 0.3 公尺頂板）；公告圖中面積未達同一棟最大面 40% 的附屬小面不再繼承 OSM 樓高，消除 162 塊與摩天大樓等高的細柱狀量體。台北雙星 C1（280 公尺）、D1（360 公尺）依捷運局新聞稿覆寫並列為地標。
- 道路改以等級外擴為半透明路面（`primary` 30、`secondary` 20、`tertiary` 14 公尺等），高架與地面的區分改依 `bridge`／`layer` 標籤判定而非路名；市民大道高架有 1.8 公尺梁深與每 30 公尺一根的中央橋墩（`src/data/structures/viaduct.ts`）。
- 樓板與站體外殼設 `polygonOffset`，消除與貼合量體共面造成的閃爍。
- 方案 B 的改建區間內新增拆除兩條既有高鐵橫渡線，跨越東界者只保留東半段。

**理由**

OSM 的 `layer` 是繪圖壓線順序，不是深度：同一條縱貫線正線出現 −1、−2、−3 三種值，當成樓層會將相連的軌道拆到相差 6 公尺的不同層。深度的唯一來源因此收斂為系統（臺鐵、高鐵）或路線（`METRO_LINES`）。公告圖的圖幅會將鄰線結構當作參考一併繪出，僅靠圖幅代號會使同一條隧道以兩種顏色、兩種深度重複繪出。

**受影響的資料檔**

- `src/data/levels.ts`、`src/data/schema.ts`、`src/data/overrides.ts`、`src/data/scene.ts`、`src/data/dorts.ts`
- `src/data/structures/viaduct.ts`（新增）、`src/data/structures/station-complex.ts`、`src/data/scenarios/proposal-b.ts`
- `src/geo/measure.ts`（新增 `nearestOnPolyline`）
- `src/render/palette.ts`、`src/render/builders.ts`、`src/render/materials.ts`、`src/app/panels.ts`
- `scripts/fetch-osm.ts`（高架不再以路名判斷）
- `docs/architecture.md`、`docs/status-quo.md`、`docs/proposals.md`

## 2026-11-21：涵蓋範圍重畫、裁切改依圖層，擷取分類修正

**變更內容**

- 兩圈涵蓋範圍重畫：西緣自淡水河西岸切口（121.4905）一路正南至莒光路緯度，不再繞出大漢溪河口與新店溪西岸；南緣自莒光路平順接上和平西路二段再轉南海路，去掉原本深入三元街、西藏路的 V 形缺口；地面範圍改繞過景福門圓環，圓環 96 個節點全數在界內；東緣在信義路口至仁愛路口之間取同一條經線 121.53831，兩圈不再於路口凸出；地下範圍的西北角外推至機場捷運過河隧道末端以西 120 公尺。
- 裁切改依圖層選範圍（`coverageRingFor(layer)` 與 `UNDERGROUND_LAYERS`），不再依底面高程。
- 兩端高程不同的斜帶量體改為真正裁切，切出的各段以 `fractionAlong()` 依弧長內插自己那一段的兩端高程。
- 擷取階段的分類改以 `location` 與 `level` 判深度（`isUnderground()`），`underground.overpassql` 移除 `way["building"]["layer"~"^-"]`；停車場僅在 `parking=underground` 時歸入地下街。台北地下街連通層（`way/646262272`）於 `overrides.ts` 補上 `kind`。
- `convert()` 改為兩輪，外環整圈由已自成圖徵的成員 way 串成的多重多邊形環於擷取階段捨棄；`relation/7684913` 與 `relation/7875303` 與成員重合的外環因此不再輸出。
- 正投影相機加上縮放上下限 0.15 至 40，永久連結的 `cam` 改以三位小數記錄縮放。
- 擷取範圍縮為新兩圈的外接矩形加 100 公尺餘裕：25.0294–25.0594° N、121.4895–121.5395° E。
- 淡水河西岸的機場捷運引道（`way/865642192`–`way/865642195`）與高架段（`way/209147242`、`way/209147243`）、與台北雙星 D1 塔基重疊的機場捷運台北車站地面輪廓（`relation/7684913`）以覆寫排除；`station-complex.ts` 的 OSM 輪廓改由地下、地面兩份資料集查詢，機場捷運台北車站的輪廓只標 `layer=-2`，新分類下歸入地面資料集。

**理由**

前一版上線後出現九項缺陷，成因分為四類。其一，OSM 的 `layer` 是繪圖壓線順序而非深度：市區建物為了壓在高架橋下常標 `layer=-1`，27 棟地面建物（台北凱撒大飯店、金融中心、中正紀念堂等）因此被判為地下街、埋入 B1，再以地下範圍裁切後浮在地面界線之外。其二，依底面高程選範圍對面狀地物不成立：水域底面為 −9.5 與 −1.2 公尺，卻隨地下範圍裁切，淡水河關聯面長達 18 公里，北端一路延伸到民生西路界線而未與地塊切齊。其三，折線的有向面積趨近於零，形心公式失真（實測 `way/137195204` 偏離 1,735 公尺且內外判定翻轉），以形心決定斜帶量體的留去會將界內的上橋引道整條捨棄，只剩橋墩。其四，`OrbitControls` 的 `minZoom` 預設為 0，空拍模式的滾輪可將縮放壓到 0.005 以下，畫面只剩背景，而每格只乘 1.05，縮回原尺度要花上百格。

界線本身的缺失另有三處：地面範圍的頂點落在景福門圓環正中、南緣在中華路二段南伸形成深入三元街與西藏路的缺口、地下範圍的西緣壓在淡水河中段而截斷機場捷運過河隧道。

**受影響的資料檔**

- `src/data/coverage.ts`（兩圈頂點、`coverageRingFor()`、`clipToCoverage()`、新增 `fractionAlong()`）
- `scripts/fetch-osm.ts`（`isUnderground()`、`classify()`、`convert()`）、`data/queries/*.overpassql`
- `src/data/osm/underground.json`、`src/data/osm/surface.json`（重新擷取）
- `src/data/overrides.ts`、`src/data/structures/station-complex.ts`
- `src/render/scene.ts`、`src/app/permalink.ts`
- `tests/coverage.test.ts`
- `docs/architecture.md`、`docs/status-quo.md`
