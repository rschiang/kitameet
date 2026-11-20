/**
 * 場景資料模型。所有幾何一律使用局部公尺座標（x 東、y 北），
 * 高程以公尺計、地面為 0、向下為負。
 */
import type { Local } from "../geo/project.ts";

/**
 * 資料可信度：
 * - `sourced`：出自文獻或官方資料，附 `sourceNote`。
 * - `derived`：由 OSM 幾何或文獻值計算而得。
 * - `estimated`：本專案推估，取得正式圖資後應修正。
 */
export type Confidence = "sourced" | "derived" | "estimated";

/** 樓層代號。`elevated` 為高架結構，`G` 為地面層。 */
export type LevelId = "elevated" | "G" | "B1" | "B2" | "B3" | "B4";

/** 圖層代號，亦為圖層面板的開關單位。 */
export type LayerId =
  | "landmark"
  | "building"
  | "elevated-road"
  | "road"
  | "station-box"
  | "platform"
  | "track"
  | "mall"
  | "metro"
  | "passage";

/** 量體類型，決定著色與建模方式。 */
export type FeatureKind =
  | "platform"
  | "track-hsr"
  | "track-tra"
  | "track-metro"
  | "underground-mall"
  | "station"
  | "station-box"
  | "slab"
  | "passage"
  | "building"
  | "landmark"
  | "elevated-road"
  | "road";

/** 方案狀態：沿用、新建、拆除、改作他用。 */
export type FeatureStatus = "existing" | "added" | "removed" | "repurposed";

export interface Feature {
  id: string;
  kind: FeatureKind;
  name?: string;
  level: LevelId;
  layer: LayerId;
  geometry: { polygon?: Local[]; polyline?: Local[] };
  /** 量體高度（公尺）；折線量體則為厚度。 */
  height?: number;
  /** 量體底面高程（公尺，地面為 0）。未指定時取所屬樓層樓板。 */
  base?: number;
  /** 折線量體的寬度（公尺）。 */
  width?: number;
  confidence: Confidence;
  sourceNote?: string;
  status?: FeatureStatus;
}

export interface LevelInfo {
  /** 樓板高程（公尺）。 */
  floor: number;
  /** 層高（公尺）。 */
  height: number;
  label: string;
  confidence: Confidence;
}

/**
 * 樓層高程表。數值為推估值，依臺北車站地上 6 層地下 4 層、
 * 總高 48 公尺的文獻描述與一般鐵路車站層高反推，
 * 取得臺北市都發局或鐵道局圖資後應整表更新。
 */
export const LEVELS: Record<LevelId, LevelInfo> = {
  elevated: { floor: 8.0, height: 9.0, label: "高架層", confidence: "estimated" },
  G: { floor: 0, height: 7.0, label: "地面層", confidence: "sourced" },
  B1: { floor: -7.0, height: 6.0, label: "B1 穿堂層", confidence: "estimated" },
  B2: { floor: -14.5, height: 7.5, label: "B2 月台層", confidence: "estimated" },
  B3: { floor: -22.0, height: 7.5, label: "B3 共用穿堂層", confidence: "estimated" },
  B4: { floor: -29.5, height: 7.5, label: "B4 捷運月台層", confidence: "estimated" },
};

/** 月台面高出軌道面的高度（公尺）。 */
export const PLATFORM_RISE = 1.1;

/** 島式月台標準寬度（公尺）。 */
export const PLATFORM_WIDTH = 12.0;

/** 股道中心線與月台中心線的距離（公尺）。 */
export const TRACK_OFFSET = 8.0;

/** 各層軌道面高程（＝月台面減去 {@link PLATFORM_RISE}）。 */
export function railLevel(level: LevelId): number {
  return LEVELS[level].floor - PLATFORM_RISE;
}

export const LAYER_LABELS: Record<LayerId, string> = {
  landmark: "地標建物",
  building: "一般建物",
  "elevated-road": "高架道路",
  road: "道路",
  "station-box": "車站量體",
  platform: "月台",
  track: "股道",
  mall: "地下街",
  metro: "捷運",
  passage: "通道",
};

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  sourced: "文獻",
  derived: "推算",
  estimated: "推估",
};
