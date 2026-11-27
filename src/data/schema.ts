/**
 * 場景資料模型。所有幾何一律使用局部公尺座標（x 東、y 北），
 * 高程一律為 EL（公尺）：自基隆平均海水面起算、向上為正，站區地面取 {@link GROUND_EL}。
 */
import type { Local } from "../geo/project.ts";
import type { StructureId } from "./levels.ts";

/**
 * 資料可信度：
 * - `sourced`：出自文獻或官方資料，附 `sourceNote`。
 * - `derived`：由 OSM 幾何或文獻值計算而得。
 * - `estimated`：本專案推估，取得正式圖資後應修正。
 */
export type Confidence = "sourced" | "derived" | "estimated";

/**
 * 樓層標籤。`elevated` 為高架結構，`G` 為地面層。
 * 標籤不代表深度：同一個 B2 在臺鐵高鐵站體與捷運站並不等深，
 * 實際樓板高程由 {@link StructureId} 對應的構造物樓層表決定。
 */
export type LevelId = "elevated" | "G" | "B1" | "B2" | "B3" | "B4";

/** 圖層代號，亦為圖層面板的開關單位。 */
export type LayerId =
  | "landmark"
  | "building"
  | "elevated-road"
  | "road"
  | "ground"
  | "terrain"
  | "station-box"
  | "platform"
  | "track"
  | "mall"
  | "metro"
  | "passage"
  | "restriction";

/** 軌道系統與捷運路線代號；決定股道、隧道與站體的著色。 */
export type LineId = "tra" | "hsr" | "bl" | "r" | "g" | "o" | "a";

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
  | "road"
  | "footway"
  | "terrain"
  | "water"
  | "sand"
  | "green"
  | "plaza"
  | "tunnel"
  | "restriction"
  | "stairs"
  | "escalator"
  | "elevator"
  | "parking"
  | "exit-shed";

/** 方案狀態：沿用、新建、拆除、改作他用。 */
export type FeatureStatus = "existing" | "added" | "removed" | "repurposed";

export interface Feature {
  id: string;
  kind: FeatureKind;
  name?: string;
  level: LevelId;
  /** 所屬構造物；決定 {@link level} 對應的實際深度。 */
  structure?: StructureId;
  /** 所屬系統或路線；決定著色。 */
  line?: LineId;
  layer: LayerId;
  /** 平面量體取 `polygon`、帶狀量體取 `polyline`、圓形隧道取 `tube`（軸心折線）。 */
  geometry: {
    polygon?: Local[];
    /**
     * 上緣輪廓，頂點數須與 `polygon` 相同且一一對應。
     * 指定時量體由下輪廓放樣至上輪廓，用於屋頂斜面、塔冠收分與外傾的翹角。
     */
    polygonTop?: Local[];
    polyline?: Local[];
    tube?: Local[];
  };
  /** 量體高度（公尺）；折線量體則為厚度。 */
  height?: number;
  /** 量體底面高程（公尺，EL）。未指定時取所屬樓層樓板。 */
  base?: number;
  /** 折線量體末端頂點的底面高程；省略時全段與 `base` 同高。僅 `polyline` 有效。 */
  baseEnd?: number;
  /** 折線量體的寬度（公尺）；`tube` 量體則為半徑。 */
  width?: number;
  /** 圓形隧道的半徑（公尺）。 */
  radius?: number;
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
 * 站區地面的高程（公尺，EL）。
 * 交通部鐵路改建工程局《工藝精進：臺北・板橋・南港車站規劃設計與施工》第 32 頁：
 * 臺北車站月台下方服務通道的底板高程 EL −13.2 公尺「約地面下深 17.7 公尺」。
 * 模型的地面為單一平面，不表現地形起伏。
 */
export const GROUND_EL = 4.5;

/** 離地高度（正值）或地面下深度（負值）換算為 EL。 */
export const aboveGround = (offset: number): number => GROUND_EL + offset;

/** 高程是否位於地面；裁切內插後的端點高程帶有浮點誤差，不以全等比較。 */
export const atGround = (elevation: number | undefined): boolean =>
  elevation !== undefined && Math.abs(elevation - GROUND_EL) < 1e-6;

/**
 * 預設樓層表，僅供未指定構造物的量體使用。
 * 數值依臺北車站地上 6 層地下 4 層、總高 48 公尺的文獻描述與一般鐵路車站層高反推，
 * 以離地高度宣告後換算為 EL；有獨立樓層表的構造物一律改走 `levels.ts` 的 `STRUCTURES`。
 */
export const LEVELS: Record<LevelId, LevelInfo> = {
  elevated: { floor: aboveGround(8.0), height: 9.0, label: "高架層", confidence: "estimated" },
  G: { floor: GROUND_EL, height: 7.0, label: "地面層", confidence: "sourced" },
  B1: { floor: aboveGround(-7.0), height: 6.0, label: "地下一層", confidence: "estimated" },
  B2: { floor: aboveGround(-14.5), height: 7.5, label: "地下二層", confidence: "estimated" },
  B3: { floor: aboveGround(-22.0), height: 7.5, label: "地下三層", confidence: "estimated" },
  B4: { floor: aboveGround(-29.5), height: 7.5, label: "地下四層", confidence: "estimated" },
};

/** 月台面高出軌道面的高度（公尺）。 */
export const PLATFORM_RISE = 1.1;

/** 島式月台標準寬度（公尺）。 */
export const PLATFORM_WIDTH = 12.0;

/** 股道中心線與月台中心線的距離（公尺）。 */
export const TRACK_OFFSET = 8.0;

/** 股道量體寬度與厚度（公尺）。 */
export const TRACK_BAND_WIDTH = 3.0;
export const TRACK_BAND_THICKNESS = 0.3;

/** 地下停車場樓面的厚度（公尺）：只表現樓面範圍。 */
export const PARKING_FLOOR_THICKNESS = 0.2;

/** 通道與樓板厚度（公尺）。 */
export const SLAB_THICKNESS = 0.4;

export const LAYER_LABELS: Record<LayerId, string> = {
  landmark: "地標建物",
  building: "一般建物",
  "elevated-road": "高架道路",
  road: "道路",
  ground: "公園水域",
  terrain: "地塊",
  "station-box": "車站量體",
  platform: "月台",
  track: "股道",
  mall: "地下街",
  metro: "捷運",
  passage: "通道",
  restriction: "禁限建範圍",
};

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  sourced: "文獻",
  derived: "推算",
  estimated: "推估",
};
