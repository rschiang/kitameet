/**
 * 方案 B：拆除 K 區地下街，於站前廣場下方新建兩座對齊的高鐵島式月台 甲、乙
 * （長 410 公尺、16 節車廂），既有第一、二月台與其包夾四線歸還臺鐵。
 *
 * 幾何全部參數化於本檔：月台位置由既有第一月台的主軸與 K 區地下街東端推算，
 * 股道由月台中心線平移後以反向曲線接回既有高鐵股道在改建界線上的位置。
 * 數值量自研究小組《臺北車站方案 B′ 軌道配置構想》疊圖，
 * 月台寬度與曲線半徑則依本專案的裁示調整（見 docs/proposals.md）。
 */
import { reverseCurveElements, sampleAlignment, type Alignment } from "../../geo/alignment.ts";
import { advance, decompose, polygonAxis } from "../../geo/measure.ts";
import { corridorPolygon, offsetPolyline, polylineCrossingAtX } from "../../geo/offset.ts";
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
  /** 改建段：既有股道在界線某側的部分視為拆除重建。 */
  rebuilt: { id: string; keep: "west" | "east"; limitX: number; note: string }[];
  /**
   * 開挖侵入段：既有構造物落在新建工程開挖範圍內的部分視為拆除重建。
   * `edge` 為包絡邊緣折線（由西往東），其左側（北側）為開挖範圍。
   */
  encroached: { ids: string[]; edge: Local[]; note: string }[];
}

// ── 固定參數 ────────────────────────────────────────────
/** 新建月台長度（公尺）：16 節車廂全長。 */
export const NEW_PLATFORM_LENGTH = 410;
/**
 * 新建月台中心線相對既有第一月台中心線的南移量（公尺）。
 * 正本 B′ 量得 52.5／70.4（中心間距 17.9 公尺），但該疊圖的月台畫得比實際窄；
 * 本專案保留 12 公尺島式月台（既有月台過窄正是改建動機之一），
 * 中心間距因此放寬為 21.0 公尺，外側股道較正本各外擴約 1.5 公尺。
 */
export const PLATFORM_OFFSETS: Record<string, number> = { 甲: 51.0, 乙: 72.0 };
/**
 * 東側反向曲線的標稱最小半徑（公尺）；
 * 個別股道必要時縮小以在界線前收攏，下限 {@link MIN_RADIUS}。
 */
export const EAST_RADIUS = 122;
/**
 * 西側反向曲線的標稱最小半徑（公尺）；同樣可為收攏而縮小，下限 {@link MIN_RADIUS}。
 * 正本 B′ 西側量得 81.5–94.5 公尺，本專案為維持 R ≥ 100 而放緩，接軌點不變。
 */
export const WEST_RADIUS = 122;
/**
 * 改建區間的東西界（局部座標 x，公尺）。
 * 西界為正本 B′ 新建股道的西端（延平北路一帶），最西約 55 公尺與既有線形幾乎重合；
 * 東界為正本的東端接軌點（中山北路一段下方、既有東喉管起點附近）。
 */
export const REBUILD_ZONE = { westX: -589, eastX: 316 } as const;
/** 轉乘通道寬度（公尺）。 */
export const PASSAGE_WIDTH = 12;
/** K 區地下街輪廓；新月台東端對齊其東端（正本 B′ 的配置）。 */
const MALL_K_ID = "way/450732441";
/** 西側反向曲線前的切線段長度（公尺）；東側無切線段，曲線自月台東端起算。 */
export const WEST_TANGENT = 10;
/** 既有高鐵股道的接軌對象：甲接北線、乙接南線。 */
const TIE_IN_IDS: Record<string, { west: string; east: string }> = {
  甲: { west: "way/13991375", east: "way/381111230" },
  乙: { west: "way/323105864", east: "way/593866771" },
};
/** 反向曲線為配合界線而縮小半徑時的下限（公尺）；低於此值即視為線形不可行。 */
const MIN_RADIUS = 100;
/** 新建工程平面包絡：外側股道中心各外放的距離（公尺，隧道壁厚與淨空）。 */
export const WORKS_CLEARANCE = 4.5;
/** 受開挖侵入檢查的站前地下街 OSM 圖徵。 */
const MALL_Z_IDS = [
  "way/328691510",
  "way/1174010640",
  "way/1174010641",
  "way/1174010642",
  "way/1174010643",
  "way/1174010644",
];

const SOURCE_NOTE =
  "幾何依研究小組《臺北車站方案 B′ 軌道配置構想》疊圖量得；該疊圖的股道為圖上幾何曲線，未對照高鐵設計規範。";

const PLATFORM1_ID = "way/584167409";

function platform1Axis() {
  const polygon = baselineById(PLATFORM1_ID)?.geometry.polygon;
  if (!polygon) throw new Error(`找不到既有第一月台 ${PLATFORM1_ID} 的輪廓`);
  return polygonAxis(polygon);
}

/** 新月台東端：既有第一月台主軸上、與 K 區地下街東端等距之處（正本量得 +50.6 公尺）。 */
function newPlatformEast(): Local {
  const axis = platform1Axis();
  const polygon = baselineById(MALL_K_ID)?.geometry.polygon;
  if (!polygon) throw new Error(`找不到 K 區地下街 ${MALL_K_ID} 的輪廓`);
  const along = Math.max(...polygon.map((p) => decompose(axis.center, axis.bearing, p).along));
  return advance(axis.center, axis.bearing, along);
}

/** 以既有第一月台主軸為基準，取得新建月台的中心線（由西往東）。 */
function newPlatformCentre(southOffset: number): Local[] {
  const axis = platform1Axis();
  const east = newPlatformEast();
  // 自月台東端往西取 410 公尺；往西行進時左側即為南側
  const line: Local[] = [east, advance(east, axis.bearing, -NEW_PLATFORM_LENGTH)];
  return offsetPolyline(line, southOffset).slice().reverse();
}

/** 既有高鐵股道在改建界線上的接軌點。 */
function tieIn(id: string, limitX: number): Local {
  const line = baselineById(id)?.geometry.polyline;
  if (!line) throw new Error(`找不到既有高鐵股道 ${id}`);
  const point = polylineCrossingAtX(line, limitX);
  if (!point) throw new Error(`既有高鐵股道 ${id} 未通過 x=${limitX} 的改建界線`);
  return point;
}

/**
 * 新建股道接回既有路廊：自端點以反向曲線橫移至接軌點的橫向位置，再直線延伸至界線。
 * `radius` 為標稱最小半徑；曲線在界線前收不攏時縮小半徑（下限 {@link MIN_RADIUS}）。
 */
function connector(
  start: Local,
  bearing: number,
  radius: number,
  target: Local,
  limitX: number,
): Local[] {
  const { lateral } = decompose(start, bearing, target);
  const cos = Math.cos((bearing * Math.PI) / 180);
  // 曲線末端已回到原方位，界線前的餘裕由 x 方向分量換算
  const remainingAt = (r: number): number => {
    const curve: Alignment = { start, bearing, elements: reverseCurveElements(r, lateral) };
    const sampled = sampleAlignment(curve, 4);
    return (limitX - sampled[sampled.length - 1][0]) / cos;
  };

  let used = radius;
  if (remainingAt(radius) < -0.25) {
    let lo = MIN_RADIUS;
    let hi = radius;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (remainingAt(mid) < -0.25) hi = mid;
      else lo = mid;
    }
    used = (lo + hi) / 2;
  }

  const elements = reverseCurveElements(used, lateral);
  const remaining = remainingAt(used);
  if (remaining > 1) elements.push({ kind: "straight", length: remaining });
  return sampleAlignment({ start, bearing, elements }, 4);
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
  const tie = TIE_IN_IDS[name];

  const line: Local[] = [
    ...connector(
      advance(west, bearing + 180, WEST_TANGENT),
      bearing + 180,
      WEST_RADIUS,
      tieIn(tie.west, REBUILD_ZONE.westX),
      REBUILD_ZONE.westX,
    )
      .slice()
      .reverse(),
    ...trackLine.slice(1, -1),
    ...connector(east, bearing, EAST_RADIUS, tieIn(tie.east, REBUILD_ZONE.eastX), REBUILD_ZONE.eastX),
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
    sourceNote: `${SOURCE_NOTE} 東、西兩側反向曲線標稱最小半徑 ${EAST_RADIUS} 公尺，外側股道為配合接軌點縮至 115 公尺；全線最小半徑不低於 ${MIN_RADIUS} 公尺。`,
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

/** 新建工程開挖範圍的南緣：乙月台南側股道中心往南外放 {@link WORKS_CLEARANCE}。 */
function excavationSouthEdge(): Local[] {
  const track = proposalB.added.find((f) => f.id === "proposal-b/track/乙-南")?.geometry.polyline;
  if (!track) throw new Error("找不到新建股道 proposal-b/track/乙-南");
  return offsetPolyline(track, -WORKS_CLEARANCE);
}

let added: Feature[] | null = null;

const HSR_NOTE = "方案 B 改建區間（延平北路至中山北路）內之既有高鐵隧道。";

export const proposalB: Scenario = {
  id: "proposal-b",
  label: "方案 B",
  removed: [
    "way/450732441",
    "way/204711163",
    "way/204616534",
    // 改建區間內的既有高鐵橫渡線：新配置不沿用，一併拆除
    "way/593871105",
    "way/593871117",
  ],
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
    ...["way/13991375", "way/323105864"].map((id) => ({
      id,
      keep: "west" as const,
      limitX: REBUILD_ZONE.westX,
      note: HSR_NOTE,
    })),
    ...["way/381111230", "way/593866771"].map((id) => ({
      id,
      keep: "east" as const,
      limitX: REBUILD_ZONE.eastX,
      note: HSR_NOTE,
    })),
    // 跨越東界的既有橫渡線：西半段隨改建拆除
    {
      id: "way/593871135",
      keep: "east" as const,
      limitX: REBUILD_ZONE.eastX,
      note: HSR_NOTE,
    },
  ],
  get encroached() {
    return [
      {
        ids: MALL_Z_IDS,
        edge: excavationSouthEdge(),
        note: "方案 B：落在新建高鐵月台箱涵開挖範圍內的站前地下街出入口，須拆除重建。",
      },
    ];
  },
};
