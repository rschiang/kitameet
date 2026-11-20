import type { FeatureKind, FeatureStatus, LayerId, LineId } from "../data/schema.ts";

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
  // 限建線為地面標線，取低彩度的灰褐色
  restriction: "#c9c2b0",
};

/**
 * 系統與路線色。原色取自維基百科 Template:台北捷運色彩（Wikidata P465／捷運局 Pantone），
 * 再與紙模型底色 BACKGROUND 以 15% 混色降彩度，使其在米白底上不致突兀。
 */
export const LINE_COLORS: Record<LineId, string> = {
  tra: "#262690", // 臺鐵 #020281
  hsr: "#ca6d36", // 高鐵 #c35617
  bl: "#2583c3", // 板南線 #0070bd
  r: "#e62448", // 淡水信義線 #e3002c
  g: "#25966e", // 松山新店線 #008659
  o: "#f7bf3a", // 中和新蘆線 #f8b61c
  a: "#9360b7", // 桃園機場捷運 #8246af
};

/** 特定量體以類型覆寫圖層色；軌道系統與路線改由 {@link LINE_COLORS} 決定。 */
export const KIND_COLORS: Partial<Record<FeatureKind, string>> = {
  "track-metro": "#7a6fae",
  slab: "#ded7c8",
  // 隧道較站體量體深一階，才能與同屬捷運圖層的車站箱涵、股道區分
  tunnel: "#5d5390",
  // 地形圖的道路邊線：較半透明路面深一階，才能在路面上看見
  "road-edge": "#cfc7b6",
};

/** 方案狀態著色：新建提案紅、拆除灰、歸還臺鐵藍。 */
export const STATUS_COLORS: Partial<Record<FeatureStatus, string>> = {
  added: "#b03a3a",
  removed: "#b9a79f",
  repurposed: "#2f4f8f",
};

/** 著色優先序：方案狀態 → 所屬路線 → 量體類型 → 圖層。 */
export function featureColor(
  kind: FeatureKind,
  layer: LayerId,
  status?: FeatureStatus,
  line?: LineId,
): string {
  if (status && STATUS_COLORS[status]) return STATUS_COLORS[status] as string;
  if (line && LINE_COLORS[line]) return LINE_COLORS[line];
  return KIND_COLORS[kind] ?? LAYER_COLORS[layer];
}
