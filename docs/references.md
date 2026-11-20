# 參考資料

本文件整理建模所依據的資料來源，依性質分類，每筆註明內容摘要與在本專案中的用途。

## 站體與樓層

### 中文維基百科「臺北車站」

<https://zh.wikipedia.org/wiki/%E8%87%BA%E5%8C%97%E8%BB%8A%E7%AB%99>

第四代站體的尺寸與樓層配置：地上 6 層、地下 4 層，長 149 公尺、寬 110 公尺、高 48 公尺；地下 1 樓為穿堂層並設五條南北向通道與南、北迴廊；地下 2 樓為月台層，4 座島式月台、9 線軌道，南側為標準軌（高鐵）、北側為窄軌（臺鐵，含 1 條通過線）；地下 3 樓為三鐵共用穿堂層；捷運板南線月台位於地下 3 樓、淡水信義線月台位於地下 4 樓。

本專案以此覆寫 OSM 的站體高度與樓層數。其中「地下 3 樓為三鐵共用穿堂層」與捷運公司的官方車站配置圖不一致，捷運部分的樓層歸屬改以官方配置圖為準。

### 捷運台北車站官方車站配置圖

車站內張貼的配置圖，記載 B1 為臺鐵高鐵大廳與東、西區停車場並通往 K 區、站前、台北、中山地下街，B2 為板南線大廳層，B3 為板南線月台層與淡水信義線大廳層，B4 為淡水信義線月台層。

本專案的捷運站樓層配置以此為準，為 `src/data/levels.ts` 中 `metro-station` 樓層表的依據。

### 臺北市捷運工程局《捷運工程大區域開挖施工實務》（PDF）

<https://wwwap3.dorts.gov.taipei/seminar/data/PDF/1-1.pdf>

機場捷運 A1 臺北車站與 C1、D1 聯開大樓共構基地的開挖實務：基地北臨市民大道、西以延平北路為界，C1 與 D1 以重慶北路相隔；地下四層、開挖深度約 27.1 公尺；B1 為車站大廳（含臨停接送、預辦登機），B2 為貨物裝卸與機電設備，B3 為捷運月台層與停車場，B4 為聯開大樓地下停車場；開挖須保護鄰近的高鐵隧道、鄭州路地下街與臺鐵地下停車場。另一份內容相同的講義為 <http://www.tcri.org.tw/cnrfiles/download/476/2.%E6%8D%B7%E9%81%8B%E5%B7%A5%E7%A8%8B%E5%A4%A7%E5%8D%80%E5%9F%9F%E9%96%8B%E6%8C%96%E6%96%BD%E5%B7%A5%E7%B6%93%E9%A9%97%E5%88%86%E4%BA%AB.pdf>。

本專案以此決定 `airport-mrt-a1` 的結構底高程與各層用途。

### 臺灣高鐵台北站樓層導覽

<https://www.thsrc.com.tw/ArticleContent/977abb69-413a-4ccf-a109-0272c24fd490>

高鐵台北站各樓層的旅客動線與設施配置，可對照 B1 穿堂與 B2 月台的關係。

### 臺灣高鐵台北站平面圖（PDF）

<https://www.thsrc.com.tw/event/map/Taipei2.pdf>

站內各層的平面配置圖，含月台、穿堂與出入口位置，用於核對月台與通道的相對關係。

### 臺鐵臺北車站出版品（PDF）

<https://www.railway.gov.tw/tra-tip-web/tip/file/ef87452a-34df-4808-97c0-c74b05b969a6>

臺鐵對臺北車站鐵路地下化工程與站體整建的說明，提供地下化工程的歷程與站區角色描述。

## 地標建物

### 中文維基百科「臺北郵局」

<https://zh.wikipedia.org/wiki/%E5%8F%B0%E5%8C%97%E9%83%B5%E5%B1%80>

1930 年落成的第二代廳舍由臺灣總督府營繕課技師栗山俊一設計，為鋼筋混凝土造三層建築，採折衷樣式，立面有山頭裝飾與古典柱頭，外牆貼北投窯場的淺咖啡色面磚；1969 年為郵務車進出拆除原拱門造型的車寄，並於三樓頂增建第四層。本專案據此決定郵局的樓層分段、正面拱廊與中央山頭的構成。

### 中文維基百科「新光人壽保險摩天大樓」

<https://zh.wikipedia.org/wiki/%E6%96%B0%E5%85%89%E4%BA%BA%E5%A3%BD%E4%BF%9D%E9%9A%AA%E6%91%A9%E5%A4%A9%E5%A4%A7%E6%A8%93>

1993 年完工，地上 51 層、地下 7 層，屋頂高 238.15 公尺、含尖頂 244.15 公尺，總樓地板面積 118,229.87 平方公尺（82 使字第 473 號使用執照）。本專案以屋頂與尖頂高度為塔冠各段的上限。

### 中文維基百科「臺北府城北門」

<https://zh.wikipedia.org/wiki/%E8%87%BA%E5%8C%97%E5%BA%9C%E5%9F%8E%E5%8C%97%E9%96%80>

光緒十年（1884 年）落成，為封閉的碉堡式城門：台座以大直北勢湖的安山岩交錯堆砌、城樓外壁以紅磚砌成並與屋頂、台座連為一體，屋頂為單簷重脊歇山式，北面圓拱門洞上方有「承恩門」橫額，外壁開二方一圓的窗洞。本專案據此決定北門的台座、城樓、門額與歇山屋頂的構成。

### 維基共享資源的地標立面照片

<https://commons.wikimedia.org/wiki/Category:North_Gate_of_Taipei_City>、<https://commons.wikimedia.org/wiki/Category:Taipei_Post_Office>、<https://commons.wikimedia.org/wiki/Category:Shin_Kong_Life_Tower>

各部高度與出挑量依這些照片的立面比例換算，平面尺寸（北門台座面寬 15.0 公尺、郵局開間 4.6 公尺、新光塔身 51.6 × 33.7 公尺）為比例尺。主要引用 `North Side of Taipei City North Gate 20240626.jpg`（北門正立面）、`Taipei North Gate, 2014.JPG`（北門側向透視）、`Taihoku Post & telegraph Office around 1933.jpg`（郵局落成初期全景，可見未拆除的拱門車寄）、`Taipei Post Office 20221122.jpg` 與 `Taipei Post Office and pedestrian crossing 20170213.jpg`（郵局現況正立面）、`Shin Kong Life Tower Southeast view.jpg`（新光塔冠分段）與 `Shin Kong Life Tower front view 20150528.jpg`（新光裙樓）。臺北車站站體的外觀則參照維基共享資源的 `臺灣鐵路局臺北車站.jpg` 與 `East side, TR Taipei Station 20260718.jpg`，用於柱列節奏、樓層帶與四坡屋頂的比例。照片僅供比例換算，不另行引用既有三維模型。

## 地下街

### 臺北市市場處：K 區地下街

<https://www.tcma.gov.taipei/News_Content.aspx?n=0D4E37187A7154F0&s=7673B74A725B3625&sms=42464882E656FEC0>

K 區地下街的沿革、位置與營運概況。本專案據此將 K 區地下街歸入 B1，並作為方案 B 拆除範圍的依據。

### 臺北市市場處：台北地下街

<https://www.tcma.gov.taipei/News_Content.aspx?n=0D4E37187A7154F0&s=3CDB32A9AC16BEEA&sms=42464882E656FEC0>

台北地下街（Y 區）全長 825 公尺、187 間店舖，位於市民大道下方，用於核對地下街的範圍與樓層。

### 臺北市市場處：臺北車站特定區地下街代號

<https://www.tcma.gov.taipei/News_Content.aspx?n=1B4C0C7262E0B622&s=5B692574C86ACDF3>

說明臺北車站特定區有 6 條軌道路線交會，並有台北（Y 區）、站前（Z 區）、中山（R 區）與 K 區共 4 條地下街分屬不同機關管理，是地下街命名與代號的依據。

## 幾何圖資

### OpenStreetMap

<https://www.openstreetmap.org/>

本專案所有平面輪廓與路線幾何的來源，授權為 Open Database License（ODbL）：<https://opendatacommons.org/licenses/odbl/>。使用時須標示「© OpenStreetMap contributors」。

模型中直接引用的主要物件包含站體 `way/23641610`、四座月台 `way/584167409`、`way/584167411`、`way/584167413`、`way/584167415`、捷運月台 `way/741259904`、`way/741259905`、機場捷運月台 `way/871105041`、`way/871105042`、K 區地下街 `way/450732441`、站前地下街 `way/328691510`、機場捷運車站輪廓 `way/1226069619`、細部建模的三座地標輪廓 `way/271754072`（臺北郵局）、`way/204711206`（新光摩天大樓）、`way/238316480`（臺北府城北門），以及既有高鐵路廊的 `way/13991375`、`way/323105864`、`way/381111230` 與 `way/593866771`。

### Overpass API

<https://wiki.openstreetmap.org/wiki/Overpass_API>

查詢語法參考文件為 <https://dev.overpass-api.de/overpass-doc/en/>。`scripts/fetch-osm.ts` 以 POST 方式查詢，必須帶 `User-Agent` 標頭，否則伺服器會回應 HTTP 406。主要端點為 <https://overpass-api.de/api/interpreter>，備用端點為 <https://overpass.kumi.systems/api/interpreter>，兩者查詢語法相同。伺服器忙碌時會回應 429、502 或 504，腳本以指數退避重試。

### 臺北都會區大眾捷運系統兩側禁限建範圍公告圖查詢系統

<https://eng.dorts.gov.taipei/br>

臺北市捷運工程局依《大眾捷運法》公告的逐幅禁限建範圍圖。圖幅索引由 ArcGIS FeatureServer 提供（<https://wwwgs.dorts.gov.taipei/server/rest/services/Hosted/BRshpNewCodeView/FeatureServer/0>，`outSR=3826`），逐幅 PDF 位於 `https://eng.dorts.gov.taipei/br/pdf/{圖幅名}.pdf`，皆不需認證。

每幅為 AutoCAD 經 `pdfplot10.hdi` 輸出的向量 PDF，內含 1/1000 地形圖底圖、捷運結構外緣、軌道中心線與限建線。圖層名只存在於增修前的舊版頁物件，現行頁物件的標記已退化為 `/OC BMC`；兩版同一圖元的座標差小於 0.03 公尺。圖面格網為 50 公尺 TWD67 TM2 方格網，圖幅索引則為 TWD97 TM2。

本專案取站區五條路線共 35 幅：南港線（`N`）、板橋線（`P`）、淡水線（`T`）、新店線（`H`）、松山線（圖幅名 `SS`、線路代號 `G`）。新莊線（`K`）的圖幅全部位於新生北路一帶，僅切到查詢範圍東緣、與站區無關，故排除。結構外緣的兩側分屬不同圖層，一側為細實線、另一側為粗虛線（PDF 中是一串長 4–6 公尺、寬 0.68 公尺的封閉四邊形）；潛盾段每孔外緣距其軌道中心線 ±2.6 至 ±2.9 公尺，隨圖幅年代而異。限建線位於結構外緣外 50.0 公尺（實測中位數 49.9），可作為套合驗算。

地形圖底圖的圖層命名有三套慣例：中文敘述（`3846$0$RC、BC、建築中或高架道路下房屋`）、國土測繪中心編碼（`3946-67$0$93110_永久性房屋`）與純編號（`3845$0$6`）。純編號者無從判定語意，一律捨棄，其範圍的建物仍由 OSM 提供。

### 國土測繪中心通用正射影像（WMTS）

<https://wmts.nlsc.gov.tw/wmts>

圖磚網址為 `https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{row}/{col}`，回應為 JPEG，須帶瀏覽器型 `User-Agent`。本專案以 2024 年版影像抽查延平南路、民生西路、館前路三處街廓，確認公告圖地形底圖的建物面與屋頂輪廓相符，且 OSM 漏繪的建物確實存在。

## 座標與投影

### EPSG:3826（TWD97 / TM2 zone 121）

<https://epsg.io/3826>

臺灣本島常用的平面坐標系統，中央經線 121 度、尺度 0.9999。本專案以 `proj4` 將 WGS84 經緯度投影至此坐標系後，減去原點座標得到局部公尺座標。

## 方案來源

### 研究小組《臺北車站方案 B′ 軌道配置構想》疊圖

檔案為 `working/臺北車站方案 B′ 軌道配置構想.html`，為方案 B 的正本輸出，未納入版控（`working/` 於 `working/.gitignore` 中以 `*` 排除）。內容為 SVG 疊圖，正北朝上、y 軸向下，標示兩座新月台、四條新建股道、既有臺鐵與高鐵股道、機場捷運路線與捷運月台。

套合參數以疊圖中描自 OSM 的圖徵（深藍臺鐵股道與紫色機場捷運路線）對 `src/data/osm/underground.json` 的對應 way 做最近點擬合求得：比例尺 554.6 px = 100 公尺（0.1803101 公尺／px），平移量 X0 = 3448.5、Y0 = 1242.5，換算式為 `local = [(px − 3448.5) × 0.1803101, (1242.5 − py) × 0.1803101]`，殘差 RMS 1.58 公尺，99.2% 的取樣點落在 8 公尺內。

使用限制：疊圖的月台繪圖寬度不可採信，既有四座月台實寬 13.1 公尺、圖上畫成 6.7–9.2 公尺；捷運月台長度係依北捷資訊圖以 145 公尺換算，OSM 實測為 204 公尺，誤差約 ±11 公尺；「臺北車站站體範圍」為 155 × 131 公尺的虛線示意框，OSM `way/23641610` 則為 168 × 141 公尺。本專案只採用疊圖的月台位置、四條股道中心線與改建區間界線，捷運月台、站體輪廓與各地下街輪廓一律維持 OSM 來源。

### 研究小組「方案 B′」示意圖（PNG）

檔案位於 `docs/assets/proposal-b-reference.png`，為上述疊圖的早期版本。圖面標示二島對齊、月台長 410 公尺（16 節）、東側正線最小半徑約 122 公尺、西側聯絡線最小半徑約 82 公尺，並註明轉乘通道、捷運月台與站體牆線位置皆為推估，新股道以緩和曲線繪製、半徑為圖上幾何值、未對照高鐵設計規範。幾何以 HTML 疊圖為準，本圖僅供對照。
