/**
 * 構造物樓層表：臺北車站周邊的地下構造各自獨立興建，樓層代號只是標籤，
 * 同樣標為 B2 的樓層在臺鐵高鐵站體與捷運站並不等深。
 * 因此深度一律由各構造物自己的樓層表決定，`schema.ts` 的 `LEVELS` 僅作為預設值。
 *
 * 取得都發局、鐵道局或捷運局的縱剖面圖後，只需修改本檔，渲染端與方案資料不受影響。
 */
import { LEVELS, PLATFORM_RISE, type Confidence, type LevelId } from "./schema.ts";

/** 具備獨立樓層表的地下構造物。 */
export type StructureId =
  | "tra-hsr-station"
  | "metro-station"
  | "airport-mrt-a1"
  | "mall-k"
  | "mall-z"
  | "mall-y"
  | "mall-r"
  | "mall-ximen"
  | "parking-east";

export interface StructureLevel {
  /** 樓板高程（公尺，地面為 0、向下為負）。 */
  floor: number;
  /** 該層淨高（公尺）。 */
  height: number;
  confidence: Confidence;
  /** 該層用途註記。 */
  note?: string;
}

export interface StructureInfo {
  label: string;
  levels: Partial<Record<LevelId, StructureLevel>>;
  /** 結構底高程（公尺）。 */
  bottom: number;
  sourceNote: string;
}

const DORTS =
  "臺北市捷運工程局《捷運工程大區域開挖施工實務》：A1 臺北車站與 C1／D1 聯開大樓共構，" +
  "基地北臨市民大道、西以延平北路為界，地下四層、開挖深度約 27.1 公尺；" +
  "B1 車站大廳（含臨停接送、預辦登機）、B2 貨物裝卸與機電設備、B3 捷運月台層與停車場、B4 聯開大樓地下停車場。";

const STATION_NOTE =
  "中文維基百科「臺北車站」：第四代站體地上 6 層、地下 4 層，B1 為穿堂層、B2 為月台層（4 座島式月台、9 線）；各層高程為依此推估。";

const METRO_NOTE =
  "捷運台北車站官方車站配置圖：B1 臺鐵高鐵大廳與停車場、B2 板南線大廳層、B3 板南線月台層與淡水信義線大廳層、B4 淡水信義線月台層；各層高程為推估。";

const MALL_NOTE = "地下街層數依臺北市市場處與營運單位資料，各層高程為推估。";

const estimated = (floor: number, height: number, note?: string): StructureLevel =>
  note === undefined
    ? { floor, height, confidence: "estimated" }
    : { floor, height, confidence: "estimated", note };

/** 層序與用途出自捷運局文獻者；樓板高程仍為推估。 */
const sourcedUse = (floor: number, height: number, note: string): StructureLevel => ({
  floor,
  height,
  confidence: "sourced",
  note,
});

/** 各構造物的樓層與結構底。除註明外高程皆為推估值。 */
export const STRUCTURES: Record<StructureId, StructureInfo> = {
  "tra-hsr-station": {
    label: "臺鐵／高鐵站體",
    levels: {
      B1: estimated(-6.5, 6.0, "穿堂層：5 條南北向通道與南、北迴廊"),
      B2: estimated(-14.5, 7.5, "月台層：4 座島式月台、9 線"),
      B3: estimated(-22.5, 7.5),
      B4: estimated(-29.5, 6.5),
    },
    bottom: -33.5,
    sourceNote: STATION_NOTE,
  },
  "metro-station": {
    label: "捷運台北車站",
    levels: {
      B1: estimated(-5.5, 5.0, "臺鐵高鐵大廳、站區地下商場"),
      B2: estimated(-11.0, 5.0, "板南線大廳層"),
      B3: estimated(-16.5, 5.0, "板南線月台層與淡水信義線大廳層"),
      B4: estimated(-23.5, 6.5, "淡水信義線月台層"),
    },
    bottom: -27.5,
    sourceNote: METRO_NOTE,
  },
  "airport-mrt-a1": {
    label: "機場捷運台北車站",
    levels: {
      B1: sourcedUse(-5.5, 5.0, "車站大廳、臨停接送與預辦登機"),
      B2: sourcedUse(-11.0, 5.0, "貨物裝卸與機電設備"),
      B3: sourcedUse(-17.0, 5.5, "捷運月台層與停車場"),
      B4: sourcedUse(-23.5, 6.0, "聯開大樓地下停車場"),
    },
    // 開挖深度 27.1 公尺為文獻值
    bottom: -27.1,
    sourceNote: DORTS,
  },
  "mall-k": {
    label: "東森廣場 K 區地下街",
    levels: {
      B1: estimated(-6.0, 5.5, "商場"),
      B2: estimated(-12.0, 5.5, "停車場"),
    },
    bottom: -15.5,
    sourceNote: MALL_NOTE,
  },
  "mall-z": {
    label: "站前地下街（Z 區）",
    levels: { B1: estimated(-6.0, 5.5) },
    bottom: -9.5,
    sourceNote: MALL_NOTE,
  },
  "mall-y": {
    label: "台北地下街（Y 區）",
    levels: { B1: estimated(-6.5, 6.0) },
    bottom: -10.0,
    sourceNote: MALL_NOTE,
  },
  "mall-r": {
    label: "中山地下街（R 區）",
    levels: { B1: estimated(-6.0, 5.5) },
    bottom: -9.5,
    sourceNote: MALL_NOTE,
  },
  "mall-ximen": {
    label: "西門地下街",
    levels: { B1: estimated(-6.0, 5.5) },
    bottom: -9.5,
    sourceNote: MALL_NOTE,
  },
  "parking-east": {
    label: "臺北車站東地下停車場",
    levels: {
      B1: estimated(-6.0, 5.5),
      B2: estimated(-12.0, 5.5),
    },
    bottom: -15.5,
    sourceNote: MALL_NOTE,
  },
};

/**
 * 查構造物的樓層。構造物未指定、或該構造物沒有這一層時，
 * 回退 {@link LEVELS} 的預設樓層表，不拋例外。
 */
export function levelOf(structure: StructureId | undefined, level: LevelId): StructureLevel {
  const own = structure === undefined ? undefined : STRUCTURES[structure]?.levels[level];
  if (own) return own;
  const fallback = LEVELS[level];
  return { floor: fallback.floor, height: fallback.height, confidence: fallback.confidence };
}

/** 該構造物該層的軌道面高程（樓板減去 {@link PLATFORM_RISE}）。 */
export function railLevelOf(structure: StructureId | undefined, level: LevelId): number {
  return levelOf(structure, level).floor - PLATFORM_RISE;
}
