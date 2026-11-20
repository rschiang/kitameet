import type { FeatureKind, FeatureStatus, LayerId } from "../data/schema.ts";

/** 紙模型色調：米白底、淡卡紙色量體，不加描邊。 */
export const BACKGROUND = "#f4f0e7";
export const GROUND = "#efe9dd";

export const LAYER_COLORS: Record<LayerId, string> = {
  landmark: "#ded5c4",
  building: "#e8e2d6",
  "elevated-road": "#e0d9cb",
  road: "#ece7dc",
  "station-box": "#d8cfc0",
  platform: "#cfd8e2",
  track: "#8d8478",
  mall: "#e3d7c2",
  metro: "#7a6fae",
  passage: "#dcd3e0",
};

/** 特定量體以類型覆寫圖層色，主要用於區分三種軌道系統。 */
export const KIND_COLORS: Partial<Record<FeatureKind, string>> = {
  "track-tra": "#2f4f8f",
  "track-hsr": "#b03a3a",
  "track-metro": "#7a6fae",
  slab: "#ded7c8",
};

/** 方案狀態著色：新建提案紅、拆除灰、歸還臺鐵藍。 */
export const STATUS_COLORS: Partial<Record<FeatureStatus, string>> = {
  added: "#b03a3a",
  removed: "#b9a79f",
  repurposed: "#2f4f8f",
};

export function featureColor(kind: FeatureKind, layer: LayerId, status?: FeatureStatus): string {
  if (status && STATUS_COLORS[status]) return STATUS_COLORS[status] as string;
  return KIND_COLORS[kind] ?? LAYER_COLORS[layer];
}
