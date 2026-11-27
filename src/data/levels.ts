/**
 * 構造物樓層表：臺北車站周邊的地下構造各自獨立興建，樓層代號只是標籤，
 * 同樣標為 B2 的樓層在臺鐵高鐵站體與捷運站並不等深。
 * 因此深度一律由各構造物自己的樓層表決定，`schema.ts` 的 `LEVELS` 僅作為預設值。
 *
 * 高程一律為 EL（基隆平均海水面起算），文獻與圖面的數值可直接填入。
 * 臺北捷運的圖面高程為 EL 加 100 公尺，填入前需減去 100。
 * 僅知離地深度的推估值以 `aboveGround()` 換算。
 */
import { GROUND_EL, LEVELS, PLATFORM_RISE, aboveGround, type Confidence, type LevelId } from "./schema.ts";

/** 具備獨立樓層表的地下構造物。 */
export type StructureId =
  | "tra-hsr-station"
  | "metro-station"
  | "metro-station-r"
  | "airport-mrt-a1"
  | "mall-k"
  | "mall-z"
  | "mall-y"
  | "mall-r"
  | "mall-ximen"
  | "metro-station-ximen"
  | "metro-station-cks"
  | "metro-station-beimen"
  | "parking-east"
  | "parking-west"
  | "metro-line-bl"
  | "metro-line-r"
  | "metro-line-g"
  | "metro-line-o";

/**
 * 臺鐵高鐵站體各層的樓板面（EL）。《工藝精進》第 30、31 頁只載板底與開挖面高程：
 * U-2 層板底 −7.476、U-3 層板底 −12.156、最終開挖面 −25.65、U-4 層基礎厚 7 公尺。
 * U-2、U-3 的樓板面取板底加 1.0 公尺（板厚為推估），U-4 的樓板面取開挖面加基礎厚。
 */
const STATION_B2 = -6.476;
const STATION_B3 = -11.156;
const STATION_B4 = -18.65;
const STATION_BOTTOM = -25.65;

/** 北門站結構底（EL）：開挖深度約 32 公尺。月台層樓板面取結構底加 3.1 公尺，比照 A1 車站 B4 樓板與最終開挖面之差。 */
const BEIMEN_BOTTOM = aboveGround(-32);
const BEIMEN_B4 = BEIMEN_BOTTOM + 3.1;
const BEIMEN_NOTE =
  "臺北捷運〈北門站車站剖面相關位置圖〉G13-SP(24.01)：B1 連通道層、B2 大廳層、B4 月台層，側式月台；" +
  "捷運局：地下四層、開挖深度約 32 公尺。月台層樓板取結構底加 3.1 公尺，比照 A1 車站。";

/**
 * 板南線站體（EL）。臺北捷運〈台北車站車站剖面相關位置圖〉BL12/R10-SP(26.05) 將板南線大廳層（B2）
 * 與臺鐵高鐵月台層的樓板畫在同一高度、板南線月台層與淡水信義線大廳層（B3）畫在同一高度；
 * 大廳層樓板取 U-2 樓板面，月台面取 U-3 樓板面，軌道面再低一個月台高。
 */
const BANNAN_B2 = STATION_B2;
const BANNAN_RAIL = STATION_B3 - PLATFORM_RISE;

/** A1 車站 B3 樓板面（EL）：捷運局施工高程。 */
const A1_B3 = -16.775;

/**
 * 本範圍內的捷運路線。`rail` 為軌道面高程（公尺，EL），
 * 潛盾段的軸心取 `rail + 1.5`、箱涵底取 `rail − 1.5`。
 */
export const METRO_LINES = {
  bl: { label: "板南線", structure: "metro-line-bl", rail: BANNAN_RAIL, note: "沿用捷運台北車站 B3 板南線月台層樓板面" },
  r: { label: "淡水信義線", structure: "metro-line-r", rail: STATION_B4, note: "沿用臺北車站 U-4 層（淡水信義線月台層）樓板面" },
  g: { label: "松山新店線", structure: "metro-line-g", rail: aboveGround(-22.0), note: "推估：北門站月台為地下三層，且須自臺鐵地下隧道下方穿越" },
  o: { label: "中和新蘆線", structure: "metro-line-o", rail: aboveGround(-20.0), note: "推估：本範圍內於忠孝新生一帶自板南線下方穿越" },
  a: { label: "機場捷運", structure: "airport-mrt-a1", rail: A1_B3, note: "沿用 A1 車站 B3 捷運月台層樓板面" },
} as const satisfies Record<string, { label: string; structure: StructureId; rail: number; note: string }>;

export type MetroLineId = keyof typeof METRO_LINES;

export interface StructureLevel {
  /** 樓板高程（公尺，EL）。 */
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
  /** 結構底高程（公尺，EL）。 */
  bottom: number;
  sourceNote: string;
}

const DORTS =
  "臺北市捷運工程局《捷運工程大區域開挖施工實務》：A1 臺北車站與 C1／D1 聯開大樓共構，" +
  "基地北臨市民大道、西以延平北路為界，地下四層、開挖深度約 27.1 公尺（自基地設計地面 EL +4.0 起算）；" +
  "B1 車站大廳（含臨停接送、預辦登機）、B2 貨物裝卸與機電設備、B3 捷運月台層與停車場、B4 聯開大樓地下停車場。" +
  "各層高程取自第 49 頁〈開挖支撐施工步驟及深度一覽表〉：B1F −3.66、B2F −9.36、B3F −16.775、B4F −20.05、最終開挖面 −23.175。";

const STATION_NOTE =
  "交通部鐵路改建工程局《工藝精進：臺北・板橋・南港車站規劃設計與施工》：U-1 為穿堂層、U-2 為月台層（4 座島式月台、9 股道）、" +
  "U-3 預留與捷運 R13 車站轉乘的穿堂、U-4 預留捷運月台層結構體；U-2 層板底 EL −7.476、U-3 層板底 EL −12.156、" +
  "最終開挖面 EL −25.65、U-4 層基礎厚 7 公尺。樓板面取板底加 1.0 公尺，板厚為推估。" +
  "B1 的動線版面依站內張貼的兩份地下一層平面圖：環廊圍繞西停車場與兩區付費區，另有三條南北向通道。";

const METRO_NOTE =
  "捷運台北車站官方車站配置圖：B1 臺鐵高鐵大廳與停車場、B2 板南線大廳層、B3 板南線月台層與淡水信義線大廳層、B4 淡水信義線月台層；" +
  "兩線站體各自獨立興建、深度不同，分列兩張樓層表。淡水信義線的 B3 大廳層即臺鐵、高鐵月台層下方與之共用的穿堂，" +
  "B3、B4 沿用臺北車站 U-3、U-4 層的樓板面；板南線 B2、B3 依臺北捷運〈台北車站車站剖面相關位置圖〉對齊臺鐵 U-2 樓板與淡水信義線 B3 樓板。";

const MALL_NOTE = "地下街層數依臺北市市場處與營運單位資料。";

export const STACKED_STATION_NOTE =
  "中文維基百科〈西門站 (臺北市)〉〈中正紀念堂站〉：地下三層車站，島式疊式月台，" +
  "地下二層為上行、地下三層為下行，為跨月台轉乘站；各層高程沿用預設樓層表，為推估值。";

const estimated = (floor: number, height: number, note?: string): StructureLevel =>
  note === undefined
    ? { floor, height, confidence: "estimated" }
    : { floor, height, confidence: "estimated", note };

const derived = (floor: number, height: number, note: string): StructureLevel => ({
  floor,
  height,
  confidence: "derived",
  note,
});

const sourced = (floor: number, height: number, note: string): StructureLevel => ({
  floor,
  height,
  confidence: "sourced",
  note,
});

/**
 * 路線構造物：公告圖只畫出平面，深度一律自該路線的軌道面推算，
 * 因此樓層表只有一層，即明挖箱涵的淨空。樓板面即軌道面。
 *
 * 只用於有自有構造物的路線；機場捷運沿用 A1 車站構造物，不得經過此處。
 */
function lineStructure(id: MetroLineId): StructureInfo {
  const line = METRO_LINES[id];
  const levels: Partial<Record<LevelId, StructureLevel>> = {};
  levels[levelLabelFor(line.rail)] = estimated(line.rail, 9.0, "明挖箱涵的樓板面與淨空");
  return {
    label: `捷運${line.label}（禁限建公告圖）`,
    levels,
    bottom: line.rail - 1.5,
    sourceNote: `臺北市捷運工程局兩側禁限建範圍公告圖；軌道面高程${line.note}。`,
  };
}

/** 以高程選最接近的預設樓層標籤；標籤只用於圖層面板的樓層開關。 */
export function levelLabelFor(elevation: number): LevelId {
  if (elevation >= GROUND_EL) return "G";
  const levels: LevelId[] = ["B1", "B2", "B3", "B4"];
  return levels.reduce((best, id) =>
    Math.abs(LEVELS[id].floor - elevation) < Math.abs(LEVELS[best].floor - elevation) ? id : best,
  );
}

/**
 * B1 各階的樓板面（EL）。出自網路資料的地下一層平面圖，圖面以捷運高程標示：
 * 臺北車站與東區停車場 101.4、M 區 98.6、K 區 95.6、Z 區 94.8、R 區 98.6 至 95.1。
 * 圖面未涵蓋 Y 區，沿用 Z 區。
 */
const STATION_B1 = 1.4;
const METRO_B1 = -1.4;
const MALL_K_B1 = -4.4;
const MALL_Z_B1 = -5.2;

const TIER_NOTE =
  "B1 樓板高程取自網路資料的地下一層平面圖，未能確認為正式圖資；" +
  "圖面高差與實地踏查的階數相符：站體 B1 至捷運 B1 為 2.8 公尺、17 階，捷運 B1 至站前地下街為 3.8 公尺、23 階，每階皆為 0.165 公尺。";

/** 各構造物的樓層與結構底。 */
export const STRUCTURES: Record<StructureId, StructureInfo> = {
  "tra-hsr-station": {
    label: "臺鐵／高鐵站體",
    levels: {
      B1: estimated(STATION_B1, 5.0, "穿堂層（U-1）：環廊、三條南北向通道與兩區付費區"),
      B2: derived(STATION_B2, 7.5, "月台層（U-2）：4 座島式月台、9 股道"),
      B3: derived(STATION_B3, 3.0, "U-3：臺鐵、高鐵、捷運共用穿堂層，位於月台層下方"),
      B4: derived(STATION_B4, 6.4, "U-4：預留的捷運月台層結構體"),
    },
    bottom: STATION_BOTTOM,
    sourceNote: STATION_NOTE + TIER_NOTE,
  },
  "metro-station": {
    label: "捷運台北車站（板南線站體）",
    levels: {
      B1: estimated(METRO_B1, 3.0, "捷運地下一層（M 區）：連通道與出口 M1 至 M8"),
      B2: derived(BANNAN_B2, 4.0, "板南線大廳層"),
      B3: derived(BANNAN_RAIL, 4.0, "板南線月台層"),
    },
    bottom: BANNAN_RAIL - 1.5,
    sourceNote: METRO_NOTE + TIER_NOTE,
  },
  "metro-station-r": {
    label: "捷運台北車站（淡水信義線站體）",
    levels: {
      B1: estimated(METRO_B1, 3.0, "捷運地下一層"),
      B3: derived(STATION_B3, 3.0, "淡水信義線大廳層：臺鐵高鐵月台層下方，與臺鐵、高鐵共用的穿堂"),
      B4: derived(STATION_B4, 4.1, "淡水信義線月台層"),
    },
    bottom: STATION_BOTTOM,
    sourceNote: METRO_NOTE + TIER_NOTE,
  },
  "airport-mrt-a1": {
    label: "機場捷運台北車站",
    levels: {
      B1: sourced(-3.66, 5.0, "車站大廳、臨停接送與預辦登機"),
      B2: sourced(-9.36, 5.0, "貨物裝卸與機電設備"),
      B3: sourced(A1_B3, 5.5, "捷運月台層與停車場"),
      B4: sourced(-20.05, 2.8, "聯開大樓地下停車場"),
    },
    bottom: -23.175,
    sourceNote: DORTS,
  },
  "mall-k": {
    label: "東森廣場 K 區地下街",
    levels: {
      B1: estimated(MALL_K_B1, 3.0, "商場"),
      B2: estimated(aboveGround(-15.5), 3.5, "停車場"),
    },
    bottom: aboveGround(-19.0),
    sourceNote: MALL_NOTE + TIER_NOTE,
  },
  "mall-z": {
    label: "站前地下街（Z 區）",
    levels: { B1: estimated(MALL_Z_B1, 3.0) },
    bottom: -8.7,
    sourceNote: MALL_NOTE + TIER_NOTE,
  },
  "mall-y": {
    label: "台北地下街（Y 區）",
    levels: { B1: estimated(MALL_Z_B1, 3.0) },
    bottom: -8.7,
    sourceNote: MALL_NOTE + TIER_NOTE,
  },
  "mall-r": {
    label: "中山地下街（R 區）",
    levels: { B1: estimated(METRO_B1, 3.0, "南端與捷運 B1 同高，往北降至 EL −4.9；模型取南端高程") },
    bottom: -4.9,
    sourceNote: MALL_NOTE + TIER_NOTE,
  },
  "mall-ximen": {
    label: "西門地下街",
    levels: { B1: estimated(aboveGround(-6.0), 5.5) },
    bottom: aboveGround(-9.5),
    sourceNote: MALL_NOTE + "各層高程為推估。",
  },
  "metro-station-ximen": {
    label: "捷運西門站",
    levels: {
      B1: estimated(aboveGround(-5.5), 5.0, "穿堂層"),
      B2: estimated(aboveGround(-14.5), 7.5, "上行月台層：板南線（西側）與松山新店線（東側）"),
      B3: estimated(aboveGround(-22.0), 7.5, "下行月台層：板南線（西側）與松山新店線（東側）"),
    },
    bottom: aboveGround(-26.0),
    sourceNote: STACKED_STATION_NOTE,
  },
  "metro-station-cks": {
    label: "捷運中正紀念堂站",
    levels: {
      B1: estimated(aboveGround(-5.5), 5.0, "穿堂層"),
      B2: estimated(aboveGround(-14.5), 7.5, "上行月台層：淡水信義線與松山新店線"),
      B3: estimated(aboveGround(-22.0), 7.5, "下行月台層：淡水信義線與松山新店線"),
    },
    bottom: aboveGround(-26.0),
    sourceNote: STACKED_STATION_NOTE,
  },
  "metro-station-beimen": {
    label: "捷運北門站",
    levels: {
      B1: estimated(aboveGround(-5.5), 5.0, "連通道層"),
      B2: estimated(aboveGround(-12.0), 5.0, "大廳層"),
      B3: estimated(aboveGround(-18.0), 5.0, "機房層"),
      B4: estimated(BEIMEN_B4, 6.0, "月台層"),
    },
    bottom: BEIMEN_BOTTOM,
    sourceNote: BEIMEN_NOTE,
  },
  "parking-east": {
    label: "臺北車站東地下停車場",
    levels: { B1: estimated(STATION_B1, 5.0) },
    bottom: -2.1,
    sourceNote: STATION_NOTE + TIER_NOTE,
  },
  "parking-west": {
    label: "臺北車站西地下停車場",
    levels: { B1: estimated(STATION_B1, 5.0) },
    bottom: -2.1,
    sourceNote: STATION_NOTE + TIER_NOTE,
  },
  "metro-line-bl": lineStructure("bl"),
  "metro-line-r": lineStructure("r"),
  "metro-line-g": lineStructure("g"),
  "metro-line-o": lineStructure("o"),
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

/** 該構造物該層的軌道面高程；結構樓板面即軌道面，月台自此長高 `PLATFORM_RISE`。 */
export function railLevelOf(structure: StructureId | undefined, level: LevelId): number {
  return levelOf(structure, level).floor;
}
