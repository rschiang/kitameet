/**
 * 方案 B：拆除 K 區地下街，於站前廣場下方新建兩座對齊的高鐵島式月台 甲、乙
 * （長 410 公尺、16 節車廂），既有第一、二月台與其包夾四線歸還臺鐵。
 *
 * 幾何全部參數化於本檔：月台位置由既有第一月台的主軸推算，
 * 股道由月台中心線平移後以線形接回既有高鐵路廊。
 * 數值對照研究小組的「方案 B′」示意圖估算，非官方設計值。
 */
import { reverseCurveElements, sampleAlignment, type Alignment } from "../../geo/alignment.ts";
import { advance, decompose, polygonAxis } from "../../geo/measure.ts";
import { corridorPolygon, offsetPolyline } from "../../geo/offset.ts";
import type { Local } from "../../geo/project.ts";
import { baselineById } from "../scene.ts";
import { levelOf, railLevelOf } from "../levels.ts";
import { PLATFORM_RISE, PLATFORM_WIDTH, TRACK_OFFSET, type Feature } from "../schema.ts";

export interface Scenario {
  id: "proposal-b";
  label: string;
  /** 拆除的既有量體 id。 */
  removed: string[];
  /** 新建量體。 */
  added: Feature[];
  /** 改作他用的既有量體。 */
  repurposed: { id: string; note: string }[];
  /** 改建段：既有股道在改建區間內的部分視為拆除重建。 */
  rebuilt: { id: string; keep: "west" | "east"; limitX: number }[];
}

// ── 固定參數 ────────────────────────────────────────────
/** 新建月台長度（公尺）：16 節車廂全長。 */
export const NEW_PLATFORM_LENGTH = 410;
/**
 * 新建月台中心線相對既有第一月台中心線的南移量（公尺）。
 * 月台沿主軸傾斜 10.5 度，410 公尺長度即佔去約 75 公尺的南北向範圍，
 * 兩座月台合計 111 公尺，略大於 K 區地下街的 104 公尺帶寬，
 * 因此取使南北兩端超出量相等的位移值。
 */
export const PLATFORM_OFFSETS: Record<string, number> = { 甲: 38, 乙: 62 };
/** 東側正線最小半徑（公尺），對照方案 B′ 示意圖估算。 */
export const EAST_RADIUS = 122;
/** 西側聯絡線最小半徑（公尺），對照方案 B′ 示意圖估算。 */
export const WEST_RADIUS = 82;
/**
 * 改建區間的東西界（局部座標 x，公尺）。
 * 西界為延平北路一段東側：其西即機場捷運 A1 車站與 C1／D1 聯開大樓共構基地
 * （地下四層、開挖深度約 27.1 公尺），無法再改建。
 * 東界為中山北路一段東側，依方案 B′ 示意圖估算。
 */
export const REBUILD_ZONE = { westX: -524, eastX: 460 } as const;
/** 既有高鐵路廊的取樣點（OSM way/381111230 與 way/323105864 端點），供新建股道對齊橫向位置。 */
export const EAST_CORRIDOR_POINT: Local = [294.4, -71.76];
export const WEST_CORRIDOR_POINT: Local = [-242.79, 21.78];
/** 轉乘通道寬度（公尺）。 */
export const PASSAGE_WIDTH = 12;

const SOURCE_NOTE = "對照方案 B′ 示意圖估算，未對照高鐵設計規範；位置與尺寸皆為推估。";

const PLATFORM1_ID = "way/584167409";

function platform1Axis() {
  const polygon = baselineById(PLATFORM1_ID)?.geometry.polygon;
  if (!polygon) throw new Error(`找不到既有第一月台 ${PLATFORM1_ID} 的輪廓`);
  return polygonAxis(polygon);
}

/** 以既有第一月台主軸為基準，取得新建月台的中心線（由西往東）。 */
function newPlatformCentre(southOffset: number): Local[] {
  const axis = platform1Axis();
  // 自既有月台東端往西取 410 公尺；往西行進時左側即為南側
  const line: Local[] = [axis.east, advance(axis.east, axis.bearing, -NEW_PLATFORM_LENGTH)];
  return offsetPolyline(line, southOffset).slice().reverse();
}

/**
 * 新建股道接回既有路廊：自端點以反向曲線橫移至既有路廊的橫向位置，
 * 再以直線延伸至改建區間的界線。界線落在起點後方時只畫曲線。
 */
function connector(
  start: Local,
  bearing: number,
  radius: number,
  corridorPoint: Local,
  limitX: number,
): Local[] {
  const { lateral } = decompose(start, bearing, corridorPoint);
  const elements = reverseCurveElements(radius, lateral);
  const curve: Alignment = { start, bearing, elements };
  const sampled = sampleAlignment(curve, 4);
  const end = sampled[sampled.length - 1];
  // 曲線末端已回到原方位，直線長度由 x 方向分量換算
  const remaining = (limitX - end[0]) / Math.cos((bearing * Math.PI) / 180);
  if (remaining <= 1) return sampled;
  return sampleAlignment(
    { ...curve, elements: [...elements, { kind: "straight", length: remaining }] },
    4,
  );
}

function platformFeature(name: string, centre: Local[]): Feature {
  return {
    id: `proposal-b/platform/${name}`,
    kind: "platform",
    name: `高鐵新月台 ${name}`,
    level: "B2",
    structure: "tra-hsr-station",
    layer: "platform",
    geometry: { polygon: corridorPolygon(centre, PLATFORM_WIDTH) },
    base: railLevelOf("tra-hsr-station", "B2"),
    height: PLATFORM_RISE,
    confidence: "estimated",
    sourceNote: `${SOURCE_NOTE} 月台長 ${NEW_PLATFORM_LENGTH} 公尺、寬 ${PLATFORM_WIDTH} 公尺。`,
    status: "added",
  };
}

function trackFeature(name: string, side: "北" | "南", centre: Local[]): Feature {
  const trackLine = offsetPolyline(centre, side === "北" ? TRACK_OFFSET : -TRACK_OFFSET);
  const west = trackLine[0];
  const east = trackLine[trackLine.length - 1];
  const bearing = (Math.atan2(east[1] - west[1], east[0] - west[0]) * 180) / Math.PI;

  const line: Local[] = [
    ...connector(west, bearing + 180, WEST_RADIUS, WEST_CORRIDOR_POINT, REBUILD_ZONE.westX)
      .slice()
      .reverse(),
    ...trackLine.slice(1, -1),
    ...connector(east, bearing, EAST_RADIUS, EAST_CORRIDOR_POINT, REBUILD_ZONE.eastX),
  ];

  return {
    id: `proposal-b/track/${name}-${side}`,
    kind: "track-hsr",
    name: `高鐵新建股道（月台 ${name} ${side}側）`,
    level: "B2",
    structure: "tra-hsr-station",
    layer: "track",
    geometry: { polyline: line },
    base: railLevelOf("tra-hsr-station", "B2"),
    height: 0.3,
    width: 3,
    confidence: "estimated",
    sourceNote: `${SOURCE_NOTE} 東側正線最小半徑 ${EAST_RADIUS} 公尺、西側聯絡線最小半徑 ${WEST_RADIUS} 公尺。`,
    status: "added",
  };
}

/** B2 轉乘通道：自最南側新月台沿南北向往北接既有月台層。 */
function passageFeature(southernCentre: Local[]): Feature {
  const mid = southernCentre[Math.floor(southernCentre.length / 2)];
  const axis = platform1Axis();
  // 既有第一月台中心線在同一 x 位置的 y 值，使通道恰為南北向
  const slope = Math.tan((axis.bearing * Math.PI) / 180);
  const northY = axis.center[1] + slope * (mid[0] - axis.center[0]);
  const line: Local[] = [mid, [mid[0], northY]];
  return {
    id: "proposal-b/passage/transfer",
    kind: "passage",
    name: "轉乘通道（B2）",
    level: "B2",
    structure: "tra-hsr-station",
    layer: "passage",
    geometry: { polygon: corridorPolygon(line, PASSAGE_WIDTH) },
    base: levelOf("tra-hsr-station", "B2").floor,
    height: 4,
    confidence: "estimated",
    sourceNote: `${SOURCE_NOTE} 轉乘通道位置為推估，寬 ${PASSAGE_WIDTH} 公尺。`,
    status: "added",
  };
}

function buildAdded(): Feature[] {
  const platforms = Object.entries(PLATFORM_OFFSETS).map(([name, offset]) => ({
    name,
    centre: newPlatformCentre(offset),
  }));

  const features: Feature[] = [];
  for (const { name, centre } of platforms) {
    features.push(platformFeature(name, centre), trackFeature(name, "北", centre), trackFeature(name, "南", centre));
  }
  features.push(passageFeature(platforms[platforms.length - 1].centre));
  return features;
}

let added: Feature[] | null = null;

export const proposalB: Scenario = {
  id: "proposal-b",
  label: "方案 B",
  removed: ["way/450732441", "way/204711163", "way/204616534"],
  get added(): Feature[] {
    added ??= buildAdded();
    return added;
  },
  repurposed: [
    { id: "way/584167409", note: "第一月台歸還臺鐵" },
    { id: "way/584167411", note: "第二月台歸還臺鐵" },
    { id: "way/593871124", note: "軌距由 1435 mm 改為 1067 mm" },
    { id: "way/593871149", note: "軌距由 1435 mm 改為 1067 mm" },
    { id: "way/615600478", note: "軌距由 1435 mm 改為 1067 mm" },
    { id: "way/615600479", note: "軌距由 1435 mm 改為 1067 mm" },
    { id: "way/615600481", note: "軌距由 1435 mm 改為 1067 mm" },
  ],
  rebuilt: [
    { id: "way/13991375", keep: "west", limitX: REBUILD_ZONE.westX },
    { id: "way/323105864", keep: "west", limitX: REBUILD_ZONE.westX },
    { id: "way/381111230", keep: "east", limitX: REBUILD_ZONE.eastX },
    { id: "way/593866771", keep: "east", limitX: REBUILD_ZONE.eastX },
  ],
};
