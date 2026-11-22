/**
 * 西門站與中正紀念堂站的疊式月台。
 *
 * 兩站皆為地下三層、島式疊式月台的跨月台轉乘站：地下二層為上行、地下三層為下行，
 * 同一層並列兩條路線。模型原本讓每條路線只有一個軌道面，兩站的正線因此與月台不同高。
 *
 * `FeatureOverride` 的 `base`／`baseEnd` 只能沿整條 OSM way 線性內插，
 * 而板南線的 `way/198199171` 橫跨全線，無法表達「站區一個深度、站外另一個深度」；
 * 本模組把指定的正線鏈依縱斷面切段，站區段落在該站月台層，站外以
 * {@link MAX_GRADE} 接回本線軌道面。
 */
import undergroundJson from "../osm/underground.json";
import surfaceJson from "../osm/surface.json";
import type { OsmDataset } from "../osm-types.ts";
import { pointInPolygon } from "../../geo/measure.ts";
import type { Local } from "../../geo/project.ts";
import {
  METRO_LINES,
  STACKED_STATION_NOTE,
  railLevelOf,
  type MetroLineId,
  type StructureId,
} from "../levels.ts";
import { STACKED_LOWER_RAIL } from "../overrides.ts";
import { PLATFORM_RISE, type Feature, type LevelId } from "../schema.ts";

const underground = undergroundJson as unknown as OsmDataset;
const surface = surfaceJson as unknown as OsmDataset;

/** 台北捷運主線的最大縱坡；站區內外的高差以此坡度接續。 */
const MAX_GRADE = 0.035;

/** 串接正線鏈時視為同一節點的距離（公尺）。 */
const JOIN_TOLERANCE = 1.0;

export interface StackedStation {
  structure: StructureId;
  /** 站區平面：OSM 站體輪廓的 id。西門站的輪廓在覆寫表被排除，故一律自原始資料取幾何。 */
  boxId: string;
}

export const STACKED_STATIONS: StackedStation[] = [
  { structure: "metro-station-ximen", boxId: "relation/16748280" },
  { structure: "metro-station-cks", boxId: "way/1061978434" },
];

/** 正線鏈：依行進順序首尾相接的 OSM way；`level` 為通過站區時的層別。 */
export interface StackedChain {
  line: MetroLineId;
  level: Extract<LevelId, "B2" | "B3">;
  ways: string[];
  /** 鏈首端在站區外的目標軌道面；省略時取該路線的軌道面。 */
  headRail?: number;
  /** 鏈尾端在站區外的目標軌道面；省略時取該路線的軌道面。 */
  tailRail?: number;
}

/**
 * 兩站的四條路線各一組上下行鏈。同一條鏈可同時通過兩站（松山新店線），
 * 兩站同層高程相同，不會衝突。
 *
 * 松山新店線下層的鏈尾接北門—西門段的疊式潛盾下管（{@link STACKED_LOWER_RAIL}），
 * 再由 `way/194585061` 的覆寫於北門站回到上層同高；該 way 因此不列入鏈中。
 */
export const STACKED_CHAINS: StackedChain[] = [
  { line: "bl", level: "B2", ways: ["way/198199171"] },
  { line: "bl", level: "B3", ways: ["way/198199196", "way/198199155"] },
  {
    line: "g",
    level: "B2",
    ways: [
      "way/24836700",
      "way/194585059",
      "way/194585060",
      "way/194585058",
      "way/194585046",
    ],
  },
  {
    line: "g",
    level: "B3",
    ways: [
      "way/194618333",
      "way/194618337",
      "way/194585052",
      "way/194585050",
      "way/194585049",
      "way/194585053",
    ],
    tailRail: STACKED_LOWER_RAIL,
  },
  { line: "r", level: "B2", ways: ["way/194618359", "way/266862892", "way/23416669"] },
  {
    line: "r",
    level: "B3",
    ways: ["way/194618293", "way/194618294", "way/194618346", "way/194618358"],
  },
];

/** 鏈上各 OSM way 的 id。 */
export const STACKED_TRACK_IDS: Set<string> = new Set(
  STACKED_CHAINS.flatMap((chain) => chain.ways),
);

const dist = (a: Local, b: Local): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

function osmPolygon(id: string): Local[] {
  for (const osm of [...underground.features, ...surface.features]) {
    if (osm.id !== id) continue;
    const polygon = osm.polygon;
    if (polygon && polygon.length >= 3) return polygon;
  }
  throw new Error(`疊式車站的站體輪廓 ${id} 不在 OSM 資料中`);
}

let stationBoxes: { station: StackedStation; polygon: Local[]; radius: number }[] | null = null;

/** 站區平面與其影響半徑（公尺）：半徑取該站各鏈過渡長度的最大值。 */
function boxes(): { station: StackedStation; polygon: Local[]; radius: number }[] {
  if (stationBoxes) return stationBoxes;
  stationBoxes = STACKED_STATIONS.map((station) => {
    let radius = 0;
    for (const chain of STACKED_CHAINS) {
      const drop = Math.abs(railLevelOf(station.structure, chain.level) - METRO_LINES[chain.line].rail);
      radius = Math.max(radius, drop / MAX_GRADE);
    }
    return { station, polygon: osmPolygon(station.boxId), radius };
  });
  return stationBoxes;
}

/** 點到多邊形邊界的距離（公尺）；點在界內回傳 0。 */
function distanceToPolygon(point: Local, polygon: Local[]): number {
  if (pointInPolygon(point, polygon)) return 0;
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(a[0] + t * dx - point[0], a[1] + t * dy - point[1]));
  }
  return best;
}

/**
 * 點是否落在任一疊式車站的影響範圍內（站區平面加過渡長度）。
 * 範圍內的正線深度由本模組決定，公告圖的軌道中心線在此讓位。
 */
export function inStackedZone(point: Local): boolean {
  return boxes().some(({ polygon, radius }) => distanceToPolygon(point, polygon) <= radius);
}

interface Joined {
  points: Local[];
  /** 各 way 在 `points` 中的頂點索引區間（相接處的頂點由前後兩段共用）。 */
  spans: { id: string; from: number; to: number }[];
}

/** 把鏈上各 way 的折線串接為一條；方向不符者反轉，接不上即擲例外。 */
function joinChain(ways: string[], polylineOf: (id: string) => Local[]): Joined {
  const points: Local[] = [];
  const spans: { id: string; from: number; to: number }[] = [];
  for (const id of ways) {
    let pts = polylineOf(id);
    if (points.length === 0) {
      if (ways.length > 1) {
        const next = polylineOf(ways[1]);
        const ends = [next[0], next[next.length - 1]];
        const meetsTail = ends.some((e) => dist(e, pts[pts.length - 1]) <= JOIN_TOLERANCE);
        const meetsHead = ends.some((e) => dist(e, pts[0]) <= JOIN_TOLERANCE);
        if (!meetsTail && !meetsHead) throw new Error(`疊式車站正線鏈 ${id} 與 ${ways[1]} 不相接`);
        if (!meetsTail) pts = [...pts].reverse();
      }
      spans.push({ id, from: 0, to: pts.length - 1 });
      points.push(...pts);
      continue;
    }
    const tail = points[points.length - 1];
    if (dist(pts[0], tail) > JOIN_TOLERANCE && dist(pts[pts.length - 1], tail) <= JOIN_TOLERANCE) {
      pts = [...pts].reverse();
    }
    if (dist(pts[0], tail) > JOIN_TOLERANCE) throw new Error(`疊式車站正線鏈 ${id} 與前一段不相接`);
    const from = points.length - 1;
    points.push(...pts.slice(1));
    spans.push({ id, from, to: points.length - 1 });
  }
  return { points, spans };
}

/** 各頂點的累積弧長。 */
function arcLengths(points: Local[]): number[] {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + dist(points[i - 1], points[i]));
  return cumulative;
}

/** 弧長位置的座標。 */
function pointAtArc(points: Local[], cumulative: number[], s: number): Local {
  if (s <= 0) return points[0];
  const total = cumulative[cumulative.length - 1];
  if (s >= total) return points[points.length - 1];
  let i = 1;
  while (i < cumulative.length && cumulative[i] < s) i++;
  const span = cumulative[i] - cumulative[i - 1];
  const t = span > 0 ? (s - cumulative[i - 1]) / span : 0;
  const a = points[i - 1];
  const b = points[i];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** 取出兩個弧長位置之間的子折線，兩端為內插出的點。 */
function sliceByArc(points: Local[], cumulative: number[], from: number, to: number): Local[] {
  const part: Local[] = [pointAtArc(points, cumulative, from)];
  for (let i = 0; i < points.length; i++) {
    if (cumulative[i] <= from) continue;
    if (cumulative[i] >= to) break;
    part.push(points[i]);
  }
  part.push(pointAtArc(points, cumulative, to));
  // 內插端點與既有頂點重合時去除重複
  return part.filter((p, i) => i === 0 || dist(p, part[i - 1]) > 1e-6);
}

/** 以二分法求斷言在線段上的切換位置（弧長）。 */
function crossingArc(
  points: Local[],
  cumulative: number[],
  i: number,
  inside: (p: Local) => boolean,
): number {
  let lo = cumulative[i];
  let hi = cumulative[i + 1];
  const loInside = inside(points[i]);
  for (let n = 0; n < 24; n++) {
    const mid = (lo + hi) / 2;
    if (inside(pointAtArc(points, cumulative, mid)) === loInside) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

interface StationRun {
  from: number;
  to: number;
  elevation: number;
  station: StackedStation;
}

/** 鏈上落在各站區內的弧長區間。 */
function stationRuns(points: Local[], cumulative: number[], chain: StackedChain): StationRun[] {
  const runs: StationRun[] = [];
  for (const { station, polygon } of boxes()) {
    const inside = (p: Local) => pointInPolygon(p, polygon);
    const flags = points.map(inside);
    let start: number | null = null;
    for (let i = 0; i < points.length; i++) {
      if (flags[i] && start === null) {
        start = i > 0 ? crossingArc(points, cumulative, i - 1, inside) : cumulative[i];
      }
      if (!flags[i] && start !== null) {
        runs.push({
          from: start,
          to: crossingArc(points, cumulative, i - 1, inside),
          elevation: railLevelOf(station.structure, chain.level),
          station,
        });
        start = null;
      }
    }
    if (start !== null) {
      runs.push({
        from: start,
        to: cumulative[cumulative.length - 1],
        elevation: railLevelOf(station.structure, chain.level),
        station,
      });
    }
  }
  return runs.sort((a, b) => a.from - b.from);
}

/**
 * 鏈的縱斷面控制點（弧長、底面高程）。
 *
 * 站區內為該站月台層；鏈首尾以 {@link MAX_GRADE} 接回目標軌道面；
 * 兩站之間維持疊式配置，兩站同層等高時全段平直，不在站間無故起伏。
 */
function controlPoints(chain: StackedChain, runs: StationRun[], total: number): [number, number][] {
  const lineRail = METRO_LINES[chain.line].rail;
  if (runs.length === 0) {
    return [
      [0, lineRail],
      [total, lineRail],
    ];
  }
  const controls: [number, number][] = [];
  const head = runs[0];
  const tail = runs[runs.length - 1];
  const headRail = chain.headRail ?? lineRail;
  const tailRail = chain.tailRail ?? lineRail;
  const headRun = Math.abs(head.elevation - headRail) / MAX_GRADE;
  const tailRun = Math.abs(tail.elevation - tailRail) / MAX_GRADE;

  if (headRun < head.from) controls.push([0, headRail], [head.from - headRun, headRail]);
  // 鏈首太短接不回本線軌道面時，自鏈首即以同坡度起算
  else controls.push([0, head.elevation + (headRail - head.elevation) * (head.from / headRun)]);

  controls.push([head.from, head.elevation]);
  for (let i = 0; i + 1 < runs.length; i++) {
    const [a, b] = [runs[i], runs[i + 1]];
    controls.push([a.to, a.elevation]);
    const climb = Math.abs(b.elevation - a.elevation) / MAX_GRADE;
    if (climb < b.from - a.to) controls.push([a.to + climb, b.elevation]);
    controls.push([b.from, b.elevation]);
  }
  controls.push([tail.to, tail.elevation]);

  if (tailRun < total - tail.to) controls.push([tail.to + tailRun, tailRail], [total, tailRail]);
  else {
    controls.push([
      total,
      tail.elevation + (tailRail - tail.elevation) * ((total - tail.to) / tailRun),
    ]);
  }
  return controls;
}

/** 控制點之間線性內插的縱斷面。 */
function profileOf(controls: [number, number][]): (s: number) => number {
  return (s: number): number => {
    if (s <= controls[0][0]) return controls[0][1];
    for (let i = 1; i < controls.length; i++) {
      const [a, ea] = controls[i - 1];
      const [b, eb] = controls[i];
      if (s > b) continue;
      return b > a ? ea + ((eb - ea) * (s - a)) / (b - a) : eb;
    }
    return controls[controls.length - 1][1];
  };
}

/** 切段位置：縱斷面轉折點、各 way 的交界、站區影響範圍的邊界（弧長）。 */
function cutsOf(controls: [number, number][], runs: StationRun[], joined: Joined, cumulative: number[]): number[] {
  const total = cumulative[cumulative.length - 1];
  const cuts = [0, total, ...controls.map(([s]) => s), ...joined.spans.map((s) => cumulative[s.to])];
  for (const run of runs) {
    const radius = boxes().find((b) => b.station === run.station)?.radius ?? 0;
    cuts.push(run.from - radius, run.to + radius);
  }
  return [...new Set(cuts.map((s) => Math.min(total, Math.max(0, s))))]
    .sort((a, b) => a - b)
    .filter((s, i, all) => i === 0 || s - all[i - 1] > 0.5);
}

const PROFILE_NOTE = `${STACKED_STATION_NOTE}站外以 ${(MAX_GRADE * 100).toFixed(1)}% 坡度接回本線軌道面。`;

/**
 * 依縱斷面把疊式車站的正線鏈切段，就地改寫 `features`：
 * 原 way 移除，換成各段（id 沿用 `way/xxx#n` 的切片慣例）。
 */
export function reprofileStackedTracks(features: Map<string, Feature>): void {
  for (const chain of STACKED_CHAINS) {
    const polylineOf = (id: string): Local[] => {
      const polyline = features.get(id)?.geometry.polyline;
      if (!polyline || polyline.length < 2) throw new Error(`疊式車站正線 ${id} 不在場景中`);
      return polyline;
    };
    const joined = joinChain(chain.ways, polylineOf);
    const { points, spans } = joined;
    const cumulative = arcLengths(points);
    const total = cumulative[cumulative.length - 1];
    const runs = stationRuns(points, cumulative, chain);
    const controls = controlPoints(chain, runs, total);
    const elevationAt = profileOf(controls);
    const cuts = cutsOf(controls, runs, joined, cumulative);

    const counts = new Map<string, number>();
    const emitted: Feature[] = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const [from, to] = [cuts[i], cuts[i + 1]];
      const middle = (from + to) / 2;
      const span = spans.find((s) => cumulative[s.from] <= middle && middle <= cumulative[s.to]);
      if (span === undefined) continue;
      const source = features.get(span.id) as Feature;
      const run = runs.find((r) => middle >= r.from && middle <= r.to);
      const base = elevationAt(from);
      const baseEnd = elevationAt(to);
      const piece: Feature = {
        ...source,
        id: span.id,
        geometry: { polyline: sliceByArc(points, cumulative, from, to) },
        level: run ? chain.level : source.level,
        structure: run ? run.station.structure : METRO_LINES[chain.line].structure,
        base,
        confidence: "estimated",
        sourceNote: PROFILE_NOTE,
      };
      if (Math.abs(baseEnd - base) > 1e-6) piece.baseEnd = baseEnd;
      else delete piece.baseEnd;
      emitted.push(piece);
      counts.set(span.id, (counts.get(span.id) ?? 0) + 1);
    }

    for (const id of chain.ways) features.delete(id);
    const index = new Map<string, number>();
    for (const piece of emitted) {
      const n = index.get(piece.id) ?? 0;
      index.set(piece.id, n + 1);
      const id = (counts.get(piece.id) as number) === 1 ? piece.id : `${piece.id}#${n}`;
      features.set(id, { ...piece, id });
    }
  }
}

/**
 * 公告圖的軌道中心線一律畫在該路線的單一軌道面，與疊式站區的深度相矛盾；
 * 站區影響範圍內的部分改由本模組的正線呈現，在此裁去。
 */
export function trimDortsTracks(features: Feature[]): Feature[] {
  const result: Feature[] = [];
  for (const feature of features) {
    const polyline = feature.geometry.polyline;
    if (feature.kind !== "track-metro" || !feature.id.startsWith("dorts/") || !polyline) {
      result.push(feature);
      continue;
    }
    if (!polyline.some(inStackedZone)) {
      result.push(feature);
      continue;
    }
    const cumulative = arcLengths(polyline);
    // 站區影響範圍外的各段各成一項；界線以二分法求交點
    const parts: Local[][] = [];
    let current: Local[] = [];
    for (let i = 0; i < polyline.length; i++) {
      const outside = !inStackedZone(polyline[i]);
      if (outside) {
        if (current.length === 0 && i > 0) {
          current.push(pointAtArc(polyline, cumulative, crossingArc(polyline, cumulative, i - 1, inStackedZone)));
        }
        current.push(polyline[i]);
        continue;
      }
      if (current.length > 0) {
        current.push(pointAtArc(polyline, cumulative, crossingArc(polyline, cumulative, i - 1, inStackedZone)));
        parts.push(current);
        current = [];
      }
    }
    if (current.length > 0) parts.push(current);
    const kept = parts.filter((part) => part.length >= 2);
    kept.forEach((part, n) => {
      const id = kept.length === 1 ? feature.id : `${feature.id}#${n}`;
      result.push({ ...feature, id, geometry: { ...feature.geometry, polyline: part } });
    });
  }
  return result;
}

/**
 * 西門站的下層月台：OSM 只畫了上層（`way/877532225`），
 * 依疊式配置於同一平面複製一塊。中正紀念堂兩層月台 OSM 均有，不另產生。
 */
export function stackedPlatforms(): Feature[] {
  const polygon = (() => {
    for (const osm of underground.features) {
      if (osm.id === "way/877532225" && osm.polygon) return osm.polygon;
    }
    throw new Error("找不到西門站上層月台 way/877532225");
  })();
  return [
    {
      id: "ximen/platform/B3",
      kind: "platform",
      name: "捷運西門站下層月台",
      level: "B3",
      layer: "platform",
      structure: "metro-station-ximen",
      geometry: { polygon },
      base: railLevelOf("metro-station-ximen", "B3"),
      height: PLATFORM_RISE,
      confidence: "estimated",
      sourceNote: `${STACKED_STATION_NOTE}OSM 僅繪出上層月台，下層依疊式配置於同一平面複製。`,
      status: "existing",
    },
  ];
}
