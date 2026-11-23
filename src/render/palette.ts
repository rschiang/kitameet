import type { FeatureKind, FeatureStatus, LayerId, LineId } from "../data/schema.ts";

/** 紙模型色調：米白底、淡卡紙色量體，不加描邊。 */
export const BACKGROUND = "#f4f0e7";
export const GROUND = "#efe9dd";

/** 股道與站體的中性色：多處共用，必須一致。 */
const TRACK_GRAY = "#8d8478";
const STATION_BODY = "#d8cfc0";

/** 兩個 `#rrggbb` 色碼於 sRGB 空間線性內插；`t` 為 `to` 所佔比例。 */
function mixHex(from: string, to: string, t: number): string {
  const a = parseInt(from.slice(1), 16);
  const b = parseInt(to.slice(1), 16);
  let hex = "";
  for (const shift of [16, 8, 0]) {
    const channel = Math.round(((a >> shift) & 0xff) * (1 - t) + ((b >> shift) & 0xff) * t);
    hex += channel.toString(16).padStart(2, "0");
  }
  return `#${hex}`;
}

export const LAYER_COLORS: Record<LayerId, string> = {
  landmark: "#ded5c4",
  building: "#e8e2d6",
  "elevated-road": "#e0d9cb",
  road: "#ece7dc",
  // 公園水域與地塊沿用底色：填色極淡，面與面之間靠不透明度區分
  ground: "#e9e3d6",
  terrain: GROUND,
  "station-box": STATION_BODY,
  // 月台與站體同為中性暖灰，不隨路線著色
  platform: "#cfc8bb",
  track: TRACK_GRAY,
  mall: "#e3d7c2",
  metro: "#7a6fae",
  passage: "#dcd3e0",
  // 限建線為地面標線，取低彩度的灰褐色
  restriction: "#c9c2b0",
};

/**
 * 系統與路線色。捷運各線原色取自維基百科 Template:台北捷運色彩（Wikidata P465／捷運局 Pantone），
 * 再與紙模型底色 BACKGROUND 以 15% 混色降彩度，使其在米白底上不致突兀。
 * 臺鐵與高鐵無對應的捷運色：取鐵灰與橘，與板南線藍、淡水信義線紅拉開距離。
 */
export const LINE_COLORS: Record<LineId, string> = {
  tra: "#646c74", // 臺鐵 鐵灰 #4a5560
  hsr: "#ef8023", // 高鐵 橘 #ee6c00
  bl: "#2583c3", // 板南線 #0070bd
  r: "#e62448", // 淡水信義線 #e3002c
  g: "#25966e", // 松山新店線 #008659
  o: "#f7bf3a", // 中和新蘆線 #f8b61c
  a: "#9360b7", // 桃園機場捷運 #8246af
};

/** 特定量體以類型覆寫圖層色；股道與隧道另混入 {@link LINE_COLORS}。 */
export const KIND_COLORS: Partial<Record<FeatureKind, string>> = {
  "track-metro": TRACK_GRAY,
  // 隧道較站體量體深一階，才能與站體、樓板區分
  tunnel: "#b3aa9c",
  // 站體箱涵與大廳、付費區必須同色：兩者頂面常共面，異色會露出接縫
  "station-box": STATION_BODY,
  station: STATION_BODY,
  slab: "#ded7c8",
  green: "#d9e0cb",
  water: "#bcd3da",
  sand: "#e6ddc6",
  plaza: "#e9e3d6",
  // 垂直動線較通道色逐階加深，一律中性灰
  stairs: "#bdb6aa",
  escalator: "#aca599",
  elevator: "#9a9387",
  parking: "#b9c9c5",
  "exit-shed": "#c9c1b3",
};

/** 方案狀態著色：新建提案紅、拆除灰、歸還臺鐵藍。 */
export const STATUS_COLORS: Partial<Record<FeatureStatus, string>> = {
  added: "#b03a3a",
  removed: "#b9a79f",
  repurposed: "#2f4f8f",
};

/** 路線色混入中性色的比例：股道中度、隧道極淡；站體、樓板、大廳與月台不著路線色。 */
export const LINE_TINT: Partial<Record<FeatureKind, number>> = {
  "track-tra": 0.6,
  "track-hsr": 0.6,
  "track-metro": 0.6,
  tunnel: 0.2,
};

/** 著色優先序：方案狀態 → 類型中性色（股道、隧道再混入路線色）→ 圖層。 */
export function featureColor(
  kind: FeatureKind,
  layer: LayerId,
  status?: FeatureStatus,
  line?: LineId,
): string {
  if (status && STATUS_COLORS[status]) return STATUS_COLORS[status] as string;
  const neutral = KIND_COLORS[kind] ?? LAYER_COLORS[layer];
  const tint = LINE_TINT[kind];
  return line && tint !== undefined ? mixHex(neutral, LINE_COLORS[line], tint) : neutral;
}
