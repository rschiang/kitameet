/**
 * 以文獻值修正 OSM 標籤的唯一位置。
 *
 * OSM 的 `level`／`layer` 標法與臺北市的樓層稱呼不一致（例如東森廣場 K 區地下街
 * 標為 level=-2，實際位於站前廣場下方的 B1），高度標籤也多有缺漏或明顯有誤，
 * 因此在此逐項覆寫並註明依據。取得臺北市都發局或鐵道局圖資後，
 * 僅需修改本檔與 `levels.ts` 的 `STRUCTURES`，渲染端不受影響。
 */
import { METRO_LINES, railLevelOf, type StructureId } from "./levels.ts";
import type { Confidence, FeatureKind, LayerId, LevelId } from "./schema.ts";

export interface FeatureOverride {
  name?: string;
  kind?: FeatureKind;
  layer?: LayerId;
  level?: LevelId;
  /** 所屬構造物；決定該樓層標籤對應的實際深度。 */
  structure?: StructureId;
  /** 排除此量體：平面輪廓改由 `structures/` 的分層量體取代。 */
  exclude?: true;
  /** 量體高度（公尺）。 */
  height?: number;
  /** 量體底面高程（公尺）。 */
  base?: number;
  /** 折線量體末端頂點的底面高程（公尺）；省略時全段與 `base` 同高。 */
  baseEnd?: number;
  confidence?: Confidence;
  sourceNote?: string;
}

const WIKI = "中文維基百科「臺北車站」條目";

/** 臺北車站第四代站體的 OSM 輪廓，供站體量體與各層樓板沿用。 */
export const STATION_OUTLINE_ID = "way/23641610";

/** 無高度標籤的一般建物：以樓層數推算，預設 4 層。 */
export const DEFAULT_BUILDING_LEVELS = 4;
export const BUILDING_LEVEL_HEIGHT = 3.5;

/** 列為地標的建物，與一般建物分屬不同圖層。細部建模的二十座地標見 `structures/landmarks/`。 */
export const LANDMARK_IDS: Record<string, string> = {
  "way/204711207": "亞洲廣場大樓",
  "way/605982572": "京站時尚廣場",
  "way/1502280687": "台北雙星 C1",
  "way/1502280746": "台北雙星 D1",
};

/** 同一構造物的多段 OSM 量體：批次指定構造物與樓層。 */
function assign(ids: string[], override: FeatureOverride): Record<string, FeatureOverride> {
  return Object.fromEntries(ids.map((id) => [id, override]));
}

const DORTS = "臺北市捷運工程局《捷運工程大區域開挖施工實務》";
const METRO_MAP = "捷運台北車站官方車站配置圖";

/**
 * 上下疊式潛盾的兩管間距（公尺）：公告圖潛盾外半徑 2.97 公尺 × 2 加淨距約 1 公尺。
 * 取得松山線 CG02 標的設計斷面後改此一處即可。
 */
const STACKED_SPACING = 7.0;
/** 疊式段下層的軌道面高程（公尺）。 */
const STACKED_LOWER_RAIL = METRO_LINES.g.rail - STACKED_SPACING;
const STACKED_NOTE =
  "捷運松山線北門—西門段為上下疊式潛盾隧道；下層軌道面取上層減一組隧道間距 " +
  `${STACKED_SPACING} 公尺（公告圖潛盾外半徑 2.97 公尺 × 2 加淨距約 1 公尺），為推估值。`;

/** 華山引道兩端的軌道面高程（公尺）：東端露出地面、西端接臺鐵站體 B2 月台層。 */
const HUASHAN_SURFACE = -1.0;
const HUASHAN_RAIL = railLevelOf("tra-hsr-station", "B2");

const TWINS_NOTE =
  "臺北市政府捷運工程局 2026 年 4 月 27 日新聞稿〈台北雙星 606 億巨資打造國門新象〉：" +
  "C1 棟 53 層約 280 公尺、D1 棟 70 層約 360 公尺（2024 年 6 月都審變更設計後之高度）。" +
  "OSM 標為 building=construction 且無高度標籤。輪廓為塔樓基座，裙樓未建模。";

export const OVERRIDES: Record<string, FeatureOverride> = {
  // ── 地標建物 ──────────────────────────────────────────
  "way/1502280687": {
    name: "台北雙星 C1",
    height: 280,
    base: 0,
    confidence: "sourced",
    sourceNote: TWINS_NOTE,
  },
  "way/1502280746": {
    name: "台北雙星 D1",
    height: 360,
    base: 0,
    confidence: "sourced",
    sourceNote: TWINS_NOTE,
  },

  // ── 誤判為車站的建物 ──────────────────────────────────
  "way/448227619": {
    kind: "building",
    sourceNote:
      "OSM 標 building=train_station，實為華山車站舊站房建物，非本模型的車站量體；高度依 building:levels=2 推估。",
  },
  "way/605982576": {
    kind: "building",
    sourceNote:
      "OSM 標 public_transport=station、building=transportation，實為京站綜合大樓內的客運轉運站量體，非軌道車站；高度無標籤，以預設樓層數推估。",
  },
  // ── 細部建模的地標 ────────────────────────────────────
  // 平面輪廓改由 `structures/landmarks/` 的台基、柱列、簷口與屋頂等量體取代。
  [STATION_OUTLINE_ID]: {
    exclude: true,
    sourceNote: `${WIKI}：第四代站體長 149 公尺、寬 110 公尺、高 48 公尺，地上 6 層、地下 4 層。地上量體改以細部模型呈現，地下各層仍沿用本輪廓。`,
  },
  "way/271754072": {
    exclude: true,
    sourceNote: "臺北郵局：OSM 輪廓僅為廳舍外框，改以細部模型呈現。",
  },
  "way/204711206": {
    exclude: true,
    sourceNote: "新光人壽保險摩天大樓：OSM 輪廓為裙樓外框，改以裙樓與塔樓的細部模型呈現。",
  },
  "way/238316480": {
    exclude: true,
    sourceNote: "臺北府城北門：OSM 輪廓僅為台座外框，改以細部模型呈現。",
  },

  // ── 地下街 ────────────────────────────────────────────
  // 市府與營運單位稱「B1」，OSM 多標為 level=-2，以下統一改為 B1。
  "way/450732441": {
    name: "東森廣場 K 區地下街",
    layer: "mall",
    level: "B1",
    structure: "mall-k",
    confidence: "estimated",
    sourceNote: `${WIKI}：K 區地下街位於站前廣場下方，與北捷站區地下商場及站前地下街連通，屬地下一層。`,
  },
  "way/204711163": {
    name: "K 區地下街停車場",
    layer: "mall",
    level: "B2",
    structure: "mall-k",
    confidence: "estimated",
    sourceNote: "臺北市市場處 K 區地下街資料：停車場位於地下街商場下方，推估為 B2。",
  },
  "way/204616534": {
    name: "K 區地下街停車場車道",
    layer: "mall",
    level: "B2",
    structure: "mall-k",
    confidence: "estimated",
    sourceNote: "與 way/204711163 同層，推估。",
  },
  "way/328691510": {
    name: "站前地下街（Z 區）",
    layer: "mall",
    level: "B1",
    structure: "mall-z",
    confidence: "estimated",
    sourceNote: `${WIKI}：站前地下街位於忠孝西路下方，屬地下一層。`,
  },
  ...assign(["way/1174010640", "way/1174010641", "way/1174010642", "way/1174010643", "way/1174010644"], {
    layer: "mall",
    level: "B1",
    structure: "mall-z",
    confidence: "estimated",
    sourceNote: "站前地下街的通道段，與 way/328691510 同層。",
  }),
  "way/450732440": {
    name: "台北地下街（Y 區）",
    layer: "mall",
    level: "B1",
    structure: "mall-y",
    confidence: "estimated",
    sourceNote: "臺北市市場處資料：台北地下街位於市民大道下方，屬地下一層。",
  },
  ...assign(
    [
      "way/1174010661",
      "way/1174010662",
      "way/1174010663",
      "way/1174010664",
      "way/1174010666",
      "way/442990106",
      "way/442990107",
      "way/442990108",
      "way/442990544",
    ],
    {
      layer: "mall",
      level: "B1",
      structure: "mall-y",
      confidence: "estimated",
      sourceNote: "台北地下街的分區與通道段，與 way/450732440 同層。",
    },
  ),
  "way/450732442": {
    name: "中山地下街（R 區）",
    layer: "mall",
    level: "B1",
    structure: "mall-r",
    confidence: "estimated",
    sourceNote: "臺北市市場處資料：中山地下街位於中山北路下方，屬地下一層。",
  },
  ...assign(["way/1174010667", "way/1210999753", "way/1210999765"], {
    layer: "mall",
    level: "B1",
    structure: "mall-r",
    confidence: "estimated",
    sourceNote: "中山地下街的通道段，與 way/450732442 同層。",
  }),
  "way/1226373332": {
    name: "西門地下街",
    layer: "mall",
    level: "B1",
    structure: "mall-ximen",
    confidence: "estimated",
    sourceNote: "臺北市市場處資料：西門地下街位於中華路下方，屬地下一層。",
  },
  "way/204711209": {
    name: "臺北車站東地下停車場",
    layer: "mall",
    level: "B1",
    structure: "parking-east",
    confidence: "estimated",
    sourceNote: "臺北車站東側地下停車場，層數與深度推估。",
  },

  // ── 捷運與機場捷運站體 ────────────────────────────────
  // 兩者的單一 OSM 輪廓改由 `structures/station-complex.ts` 的分層量體取代。
  "way/366766273": { exclude: true },
  "way/1226069619": { exclude: true },
  // 機場捷運台北車站多重多邊形剩下的外環（成員 `way/463218475`）：
  // 地面輪廓與台北雙星 D1 的塔基重疊，站體本身已由分層量體呈現
  "relation/7684913": { exclude: true },
  "way/646262272": {
    // 名稱標為「台北車站」，位置卻在市民大道下方的台北地下街西段，故歸入台北地下街。
    // 面上只有 building=transportation 與 layer=-1，擷取階段會判為地面建物，故在此指定類型
    name: "台北地下街連通層",
    kind: "underground-mall",
    layer: "mall",
    level: "B1",
    structure: "mall-y",
    confidence: "estimated",
    sourceNote: "OSM 名稱為「台北車站」，但輪廓位於市民大道下方、台北地下街西段，依位置歸入台北地下街。",
  },

  // ── 捷運月台 ──────────────────────────────────────────
  "way/741259904": {
    name: "捷運板南線月台",
    layer: "metro",
    level: "B3",
    structure: "metro-station",
    confidence: "sourced",
    sourceNote: `${METRO_MAP}：板南線月台位於地下三樓，站體在忠孝西路下方。`,
  },
  "way/741259905": {
    name: "捷運淡水信義線月台",
    layer: "metro",
    level: "B4",
    structure: "metro-station",
    confidence: "sourced",
    sourceNote: `${METRO_MAP}：淡水信義線月台位於地下四樓，站體在公園路下方。`,
  },

  // ── 捷運正線 ──────────────────────────────────────────
  // 深度一律由 `levels.ts` 的 METRO_LINES 依 OSM `ref` 給出；以下只列線上無法推得者。
  // 松山新店線北門—西門段為上下疊式潛盾，OSM 以 layer 表示上下關係，下層另行覆寫。
  ...assign(["way/194585049", "way/194585053"], {
    layer: "metro",
    level: "B4",
    structure: "metro-line-g",
    base: STACKED_LOWER_RAIL,
    confidence: "estimated",
    sourceNote: STACKED_NOTE,
  }),
  "way/194585061": {
    layer: "metro",
    level: "B4",
    structure: "metro-line-g",
    base: STACKED_LOWER_RAIL,
    baseEnd: METRO_LINES.g.rail,
    confidence: "estimated",
    sourceNote: `${STACKED_NOTE}本段北端於北門站回到與上層同高。`,
  },

  // ── 華山引道 ──────────────────────────────────────────
  ...assign(["way/542501098", "way/542501099"], {
    name: "華山引道",
    level: "B2",
    structure: "tra-hsr-station",
    base: HUASHAN_SURFACE,
    baseEnd: HUASHAN_RAIL,
    confidence: "estimated",
    sourceNote:
      "原臺北車站地下化專案引道，今為緊急搶修基地；OSM 標 `layer=-1`，" +
      "實為自 B2 月台層爬升至地面的引道，全長約 410 公尺、坡度約 3.3%，高程為推估。",
  }),
  ...assign(
    [
      "way/1558102738",
      "way/1558102739",
      "way/619251068",
      "way/619251069",
      "way/170432840",
      "way/198163706",
      "way/619251066",
      "way/619251067",
      "way/871105040",
      "way/748971523",
    ],
    {
      layer: "metro",
      level: "B3",
      structure: "airport-mrt-a1",
      confidence: "estimated",
      sourceNote: `機場捷運 A1 進站段。${DORTS}：A1 車站 B3 為捷運月台層。OSM 原圖徵標 level=-1 或無標籤，與月台層不符。`,
    },
  ),
  ...assign(["way/871105041", "way/871105042"], {
    name: "機場捷運台北車站月台",
    layer: "platform",
    level: "B3",
    structure: "airport-mrt-a1",
    confidence: "sourced",
    sourceNote: `${DORTS}：A1 車站 B3 為捷運月台層。OSM 原圖徵無 level 標籤。`,
  }),
  // 淡水河西岸的機場捷運引道（`865642*`）與高架段（`209147242`、`209147243`）：
  // 地下涵蓋範圍向西擴只為保全過河隧道，這兩段既非地下結構也不在本模型的研究範圍，
  // 留著會在河西以 B3 深度畫出一條不存在的隧道
  ...assign(
    [
      "way/865642192",
      "way/865642193",
      "way/865642194",
      "way/865642195",
      "way/209147242",
      "way/209147243",
    ],
    { exclude: true },
  ),

  // ── 臺鐵、高鐵月台 ────────────────────────────────────
  ...assign(["way/584167409", "way/584167411"], {
    level: "B2",
    structure: "tra-hsr-station",
    confidence: "sourced",
    sourceNote: `${WIKI}：地下二樓為月台層，南側第 1、2 月台為標準軌（高鐵）。`,
  }),
  ...assign(["way/584167413", "way/584167415"], {
    level: "B2",
    structure: "tra-hsr-station",
    confidence: "sourced",
    sourceNote: `${WIKI}：地下二樓為月台層，北側第 3、4 月台為窄軌（臺鐵）。`,
  }),
};

/**
 * OSM 的 `level`／`layer` 轉本專案樓層代號。
 * 地下街一律歸入 B1（OSM 慣以 -2 表示，與市府稱呼不一致），
 * 其餘以絕對值對應並上限至 B4。
 */
export function levelFromOsm(kind: FeatureKind, level: number | undefined): LevelId {
  if (kind === "underground-mall") return "B1";
  if (level === undefined || level >= 0) return "G";
  const depth = Math.min(4, Math.round(Math.abs(level)));
  return (["G", "B1", "B2", "B3", "B4"] as const)[depth];
}
