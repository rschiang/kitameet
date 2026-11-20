/**
 * 以文獻值修正 OSM 標籤的唯一位置。
 *
 * OSM 的 `level`／`layer` 標法與臺北市的樓層稱呼不一致（例如東森廣場 K 區地下街
 * 標為 level=-2，實際位於站前廣場下方的 B1），高度標籤也多有缺漏或明顯有誤，
 * 因此在此逐項覆寫並註明依據。取得臺北市都發局或鐵道局圖資後，
 * 僅需修改本檔與 `levels.ts` 的 `STRUCTURES`，渲染端不受影響。
 */
import type { StructureId } from "./levels.ts";
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
  confidence?: Confidence;
  sourceNote?: string;
}

const WIKI = "中文維基百科「臺北車站」條目";

/** 臺北車站第四代站體的 OSM 輪廓，供站體量體與各層樓板沿用。 */
export const STATION_OUTLINE_ID = "way/23641610";

/** 無高度標籤的一般建物：以樓層數推算，預設 4 層。 */
export const DEFAULT_BUILDING_LEVELS = 4;
export const BUILDING_LEVEL_HEIGHT = 3.5;

/** 列為地標的建物，與一般建物分屬不同圖層。 */
export const LANDMARK_IDS: Record<string, string> = {
  "way/204711206": "新光人壽保險摩天大樓",
  "way/204711207": "亞洲廣場大樓",
  "way/605982572": "京站時尚廣場",
  "way/23641610": "臺北車站",
};

/** 同一構造物的多段 OSM 量體：批次指定構造物與樓層。 */
function assign(ids: string[], override: FeatureOverride): Record<string, FeatureOverride> {
  return Object.fromEntries(ids.map((id) => [id, override]));
}

const DORTS = "臺北市捷運工程局《捷運工程大區域開挖施工實務》";
const METRO_MAP = "捷運台北車站官方車站配置圖";
/** 捷運正線的 OSM level 標籤與月台層不一致，一律以站區月台層為準。 */
const METRO_TRACK_NOTE =
  `${METRO_MAP}：以臺北車站站區的月台層深度呈現全線，站區外的實際深度不在模型範圍。`;

export const OVERRIDES: Record<string, FeatureOverride> = {
  // ── 站體 ──────────────────────────────────────────────
  [STATION_OUTLINE_ID]: {
    name: "臺北車站",
    kind: "station",
    layer: "station-box",
    level: "G",
    structure: "tra-hsr-station",
    height: 48,
    base: 0,
    confidence: "sourced",
    sourceNote: `${WIKI}：第四代站體長 149 公尺、寬 110 公尺、高 48 公尺，地上 6 層、地下 4 層。OSM 的 height=30、building:levels=7 與文獻不符，已覆寫。`,
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
  "way/646262272": {
    // 名稱標為「台北車站」，位置卻在市民大道下方的台北地下街西段，故歸入台北地下街
    name: "台北地下街連通層",
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
  // OSM 的板南線標 level=-2、淡水信義線標 -4，與官方配置圖的月台層不符，逐一覆寫。
  ...assign(["way/198199155", "way/198199171", "way/198199183"], {
    layer: "metro",
    level: "B3",
    structure: "metro-station",
    confidence: "estimated",
    sourceNote: `板南線正線。${METRO_TRACK_NOTE}`,
  }),
  ...assign(
    [
      "way/194618296",
      "way/194618307",
      "way/194618322",
      "way/194618326",
      "way/194618361",
      "way/194618365",
      "way/1226066660",
      "way/1226066663",
      "way/1226066664",
    ],
    {
      layer: "metro",
      level: "B4",
      structure: "metro-station",
      confidence: "estimated",
      sourceNote: `淡水信義線正線。${METRO_TRACK_NOTE}`,
    },
  ),
  ...assign(["way/1558102738", "way/1558102739", "way/619251068", "way/619251069"], {
    layer: "metro",
    level: "B3",
    structure: "airport-mrt-a1",
    confidence: "estimated",
    sourceNote: `機場捷運 A1 進站段。${DORTS}：A1 車站 B3 為捷運月台層。`,
  }),

  // ── 臺鐵、高鐵月台 ────────────────────────────────────
  "way/584167409": {
    level: "B2",
    confidence: "sourced",
    sourceNote: `${WIKI}：地下二樓為月台層，南側第 1、2 月台為標準軌（高鐵）。`,
  },
  "way/584167411": {
    level: "B2",
    confidence: "sourced",
    sourceNote: `${WIKI}：地下二樓為月台層，南側第 1、2 月台為標準軌（高鐵）。`,
  },
  "way/584167413": {
    level: "B2",
    confidence: "sourced",
    sourceNote: `${WIKI}：地下二樓為月台層，北側第 3、4 月台為窄軌（臺鐵）。`,
  },
  "way/584167415": {
    level: "B2",
    confidence: "sourced",
    sourceNote: `${WIKI}：地下二樓為月台層，北側第 3、4 月台為窄軌（臺鐵）。`,
  },
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
