/**
 * 西門站與中正紀念堂站的疊式月台，以及北門站的月台層。
 *
 * 西門、中正紀念堂兩站皆為地下三層、島式疊式月台的跨月台轉乘站：地下二層為上行、地下三層為下行，
 * 同一層並列兩條路線；北門站的松山新店線月台位於 B4。模型原本讓每條路線只有一個軌道面，
 * 這幾站的正線因此與月台不同高。
 *
 * `FeatureOverride` 的 `base`／`baseEnd` 只能沿整條 OSM way 線性內插，
 * 而板南線的 `way/198199171` 橫跨全線，無法表達「站區一個深度、站外另一個深度」；
 * 本模組把指定的正線鏈依縱斷面切段，站區段落在該站月台層，站外以
 * {@link MAX_GRADE} 接回本線軌道面。縱斷面偏離本線軌道面的一段由本模組掌管
 * （見 {@link inStackedZone}），公告圖的單一軌道面軌道在此讓位，其餘仍由公告圖呈現。
 */
import undergroundJson from "../osm/underground.json";
import surfaceJson from "../osm/surface.json";
import type { OsmDataset } from "../osm-types.ts";
import { distanceToPolygon, pointInPolygon } from "../../geo/measure.ts";
import type { Local } from "../../geo/project.ts";
import { polylineLength, slicePolyline } from "../../geo/offset.ts";
import {
  METRO_LINES,
  STACKED_STATION_NOTE,
  railLevelOf,
  type MetroLineId,
  type StructureId,
} from "../levels.ts";
import { dortsTrackLine } from "../dorts.ts";
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
  /** 停靠本站、由本模組決定站區深度的路線。 */
  lines: MetroLineId[];
  /** 各鏈通過本站時的樓層；省略時取鏈本身的 `level`。北門站兩線皆停靠 B4。 */
  level?: LevelId;
  /** 站區平面：OSM 站體輪廓的 id。西門站的輪廓在覆寫表被排除，故一律自原始資料取幾何。 */
  boxId: string;
}

export const STACKED_STATIONS: StackedStation[] = [
  { structure: "metro-station-ximen", lines: ["bl", "g"], boxId: "relation/16748280" },
  { structure: "metro-station-cks", lines: ["r", "g"], boxId: "way/1061978434" },
  { structure: "metro-station-beimen", lines: ["g"], boxId: "way/1226069618", level: "B4" },
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
  /**
   * 公告圖軌道 id；其靠近站區的端點為疊式潛盾轉為左右並列處。
   * 最近一站的影響範圍擴及此點，鏈尾在離開影響範圍處（即並列處）回到 `tailRail`；
   * 省略時鏈尾以 {@link MAX_GRADE} 接回。
   */
  tailConvergence?: string;
}

/**
 * 各站停靠路線的上下行鏈。同一條鏈可同時通過兩站（松山新店線），
 * 兩站同層高程相同，不會衝突。
 *
 * 松山新店線下層的鏈尾接北門—西門段的疊式潛盾下管（{@link STACKED_LOWER_RAIL}），
 * 再由北行的下層鏈進入北門站 B4 月台層。
 */
export const STACKED_CHAINS: StackedChain[] = [
  // 西門—臺北車站的上下疊式潛盾於里程 0+800 轉為左右並列，即 `dorts/N/track/8` 的西端點
  { line: "bl", level: "B2", ways: ["way/198199171"], tailConvergence: "dorts/N/track/8" },
  {
    line: "bl",
    level: "B3",
    ways: ["way/198199196", "way/198199155"],
    tailConvergence: "dorts/N/track/8",
  },
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
  // 下層疊式潛盾管北行進入北門站，與上層並列於 B4 月台層後接回本線軌道面
  { line: "g", level: "B3", ways: ["way/194585061", "way/196868578"], headRail: STACKED_LOWER_RAIL },
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

/** OSM 原始折線；場景的量體幾何即取自此，與 `scene.ts` 同樣以地下資料集優先。 */
function osmPolyline(id: string): Local[] {
  for (const osm of [...underground.features, ...surface.features]) {
    if (osm.id !== id) continue;
    const polyline = osm.polyline;
    if (polyline && polyline.length >= 2) return polyline;
  }
  throw new Error(`疊式車站正線 ${id} 不在 OSM 資料中`);
}

let stationBoxes: { station: StackedStation; polygon: Local[] }[] | null = null;

/** 各疊式車站的站區平面。 */
function boxes(): { station: StackedStation; polygon: Local[] }[] {
  stationBoxes ??= STACKED_STATIONS.map((station) => ({ station, polygon: osmPolygon(station.boxId) }));
  return stationBoxes;
}

/** 鏈尾的並列點：公告圖軌道兩端中，離停靠該路線各站站區較近的一端。 */
function convergencePoint(chain: StackedChain): Local {
  if (chain.tailConvergence === undefined) throw new Error(`疊式段 ${chain.ways[0]} 沒有並列點`);
  const polygons = boxes().flatMap((b) => (b.station.lines.includes(chain.line) ? [b.polygon] : []));
  if (polygons.length === 0) throw new Error(`疊式段 ${chain.ways[0]} 的路線沒有停靠任何疊式車站`);
  const line = dortsTrackLine(chain.tailConvergence);
  const gap = (p: Local): number => Math.min(...polygons.map((polygon) => distanceToPolygon(p, polygon)));
  const [first, last] = [line[0], line[line.length - 1]];
  return gap(first) <= gap(last) ? first : last;
}

/**
 * 鏈的縱斷面與其掌管的弧長區間 `owned`：縱斷面偏離本線軌道面之處，
 * 自鏈首的過渡段起、經各站與站間的疊式段，至鏈尾的過渡段或並列點止；鏈不經任何疊式車站時為 null。
 */
interface ChainProfile {
  chain: StackedChain;
  joined: Joined;
  cumulative: number[];
  runs: StationRun[];
  controls: [number, number][];
  owned: [number, number] | null;
}

/**
 * 與鏈相距此值以內、投影落在掌管區間的點屬於疊式範圍（公尺）：
 * 涵蓋公告圖與 OSM 軌道的差距，以及上下行兩鏈的間距。
 */
const ZONE_REACH = 15;

let chainProfiles: ChainProfile[] | null = null;

function profiles(): ChainProfile[] {
  chainProfiles ??= STACKED_CHAINS.map((chain) => {
    const joined = joinChain(chain.ways, osmPolyline);
    const cumulative = arcLengths(joined.points);
    const total = cumulative[cumulative.length - 1];
    const runs = stationRuns(joined.points, cumulative, chain);
    const convergenceArc =
      chain.tailConvergence === undefined
        ? undefined
        : nearestArc(joined.points, cumulative, convergencePoint(chain)).arc;
    return { chain, joined, cumulative, runs, ...controlPoints(chain, runs, total, convergenceArc) };
  });
  return chainProfiles;
}

/**
 * 捷運正線上的點是否落在疊式範圍內：與某條鏈相距 {@link ZONE_REACH} 以內，且投影落在該鏈的掌管區間。
 * 範圍內的正線深度由本模組決定，公告圖的軌道中心線在此讓位；
 * 界線即過渡段端點的法線，公告圖軌道與 OSM 正線因此在同一處交接。
 * 不分路線：疊式車站內兩線並行，公告圖在此常把鄰線的參考軌道併入本線軌道（如 `dorts/N/track/4` 的西端）。
 */
export function inStackedZone(point: Local): boolean {
  return profiles().some(({ joined, cumulative, owned }) => {
    if (owned === null) return false;
    const { distance, arc } = nearestArc(joined.points, cumulative, point);
    return distance <= ZONE_REACH && arc >= owned[0] && arc <= owned[1];
  });
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

/** 鏈上落在停靠本路線的各站站區內的弧長區間。 */
function stationRuns(points: Local[], cumulative: number[], chain: StackedChain): StationRun[] {
  const runs: StationRun[] = [];
  for (const { station, polygon } of boxes()) {
    if (!station.lines.includes(chain.line)) continue;
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
          elevation: railLevelOf(station.structure, station.level ?? chain.level),
          station,
        });
        start = null;
      }
    }
    if (start !== null) {
      runs.push({
        from: start,
        to: cumulative[cumulative.length - 1],
        elevation: railLevelOf(station.structure, station.level ?? chain.level),
        station,
      });
    }
  }
  return runs.sort((a, b) => a.from - b.from);
}

/**
 * 鏈的縱斷面控制點（弧長、底面高程）與掌管區間。
 *
 * 站區內為該站月台層；鏈首尾以 {@link MAX_GRADE} 接回目標軌道面；
 * 兩站之間維持疊式配置，兩站同層等高時全段平直，不在站間無故起伏。
 * 有 `convergenceArc` 時，鏈尾維持疊式至並列點才回到目標軌道面。
 */
function controlPoints(
  chain: StackedChain,
  runs: StationRun[],
  total: number,
  convergenceArc?: number,
): { controls: [number, number][]; owned: [number, number] | null } {
  const lineRail = METRO_LINES[chain.line].rail;
  if (runs.length === 0) {
    return {
      controls: [
        [0, lineRail],
        [total, lineRail],
      ],
      owned: null,
    };
  }
  const controls: [number, number][] = [];
  const head = runs[0];
  const tail = runs[runs.length - 1];
  const headRail = chain.headRail ?? lineRail;
  const tailRail = chain.tailRail ?? lineRail;
  const headRun = Math.abs(head.elevation - headRail) / MAX_GRADE;
  const tailRun = Math.abs(tail.elevation - tailRail) / MAX_GRADE;
  const headReturn = head.from - headRun;

  if (headRun < head.from) controls.push([0, headRail], [headReturn, headRail]);
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

  let tailReturn = total;
  if (convergenceArc !== undefined) {
    const grade = Math.abs(tailRail - tail.elevation) / (convergenceArc - tail.to);
    if (convergenceArc <= tail.to + 1 || grade > MAX_GRADE) {
      throw new Error(`疊式段 ${chain.ways[0]} 的並列點落在站區內或坡度超過 ${MAX_GRADE}`);
    }
    controls.push([convergenceArc, tailRail], [total, tailRail]);
    tailReturn = convergenceArc;
  } else if (tailRun < total - tail.to) {
    controls.push([tail.to + tailRun, tailRail], [total, tailRail]);
    tailReturn = tail.to + tailRun;
  } else {
    controls.push([total, tail.elevation + (tailRail - tail.elevation) * ((total - tail.to) / tailRun)]);
  }
  // 鏈端的目標軌道面不是本線軌道面時（疊式潛盾下管），整段直到該端都由本模組掌管
  const owned: [number, number] = [
    chain.headRail === undefined ? Math.max(0, headReturn) : 0,
    chain.tailRail === undefined ? tailReturn : total,
  ];
  return { controls, owned };
}

/** 點到折線的距離與最近點的累積弧長。 */
function nearestArc(points: Local[], cumulative: number[], p: Local): { distance: number; arc: number } {
  let best = { distance: Infinity, arc: 0 };
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const [vx, vy] = [b[0] - a[0], b[1] - a[1]];
    const len2 = vx * vx + vy * vy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2));
    const distance = Math.hypot(a[0] + vx * t - p[0], a[1] + vy * t - p[1]);
    if (distance < best.distance) best = { distance, arc: cumulative[i - 1] + t * Math.sqrt(len2) };
  }
  return best;
}

/** 鏈與疊式範圍界線的交點（弧長，遞增）；與公告圖軌道的裁切位置一致。 */
function zoneCrossings(points: Local[], cumulative: number[]): number[] {
  const flags = points.map(inStackedZone);
  const crossings: number[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    if (flags[i] !== flags[i + 1]) crossings.push(crossingArc(points, cumulative, i, inStackedZone));
  }
  return crossings;
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

/**
 * 切段位置：縱斷面轉折點、各 way 的交界、疊式範圍的界線（弧長）。
 * 範圍外的段落因此整段在界外，可由公告圖軌道取代。
 */
function cutsOf(
  controls: [number, number][],
  crossings: number[],
  joined: Joined,
  cumulative: number[],
): number[] {
  const total = cumulative[cumulative.length - 1];
  const cuts = [
    0,
    total,
    ...controls.map(([s]) => s),
    ...joined.spans.map((s) => cumulative[s.to]),
    ...crossings,
  ];
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
  for (const { chain, joined, cumulative, runs, controls } of profiles()) {
    for (const id of chain.ways) {
      if (!features.get(id)?.geometry.polyline) throw new Error(`疊式車站正線 ${id} 不在場景中`);
    }
    const { points, spans } = joined;
    const elevationAt = profileOf(controls);
    const cuts = cutsOf(controls, zoneCrossings(points, cumulative), joined, cumulative);

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
        level: run ? (run.station.level ?? chain.level) : source.level,
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
    // 疊式範圍外的各段各成一項；界線以二分法求交點
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

/** 公告圖軌道與 OSM 正線交接時，端點視為同一處的距離上限（公尺）。 */
const HANDOVER_REACH = 15;
/** 交接漸移的長度（公尺）。 */
const HANDOVER_TAPER = 60;
/** 端點相距小於此值即視為已銜接（公尺）。 */
const HANDOVER_JOINED = 0.05;
/** 漸移段的頂點間距上限（公尺）：OSM 頂點稀疏，不加密會把漸移曲線畫成折線。 */
const HANDOVER_STEP = 2;
/** 同一條 OSM 正線切出的段落共用端點；相距小於此值即視為首尾相接（公尺）。 */
const PIECE_JOIN = 1e-6;

/** 朝交接端排列的 OSM 段落：`pts` 的末點朝向交接端，`reversed` 表示與原方向相反。 */
interface OrientedPiece {
  feature: Feature;
  pts: Local[];
  reversed: boolean;
}

/** 加密折線：弧長 `from` 之後的各段每 {@link HANDOVER_STEP} 公尺內補一個頂點。 */
function densifyAfter(pts: Local[], from: number): Local[] {
  const out: Local[] = [pts[0]];
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const seg = dist(a, b);
    if (walked + seg > from) {
      const n = Math.ceil(seg / HANDOVER_STEP);
      for (let k = 1; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    out.push(b);
    walked += seg;
  }
  return out;
}

/**
 * 公告圖軌道與 OSM 正線的交接：兩者的端點常相差數公尺，接成段差。
 * 對每條公告圖軌道的兩端，取同路線 OSM 正線中端點最近者（{@link HANDOVER_REACH} 內），
 * 自該端往回串接首尾相接的 OSM 段落，在末端 {@link HANDOVER_TAPER} 公尺內漸移到公告圖端點；
 * 疊式站區的切段可能短於漸移長度，只移動單一段落會在段落交界留下折角。
 * 每個 OSM 端點只處理一次；回傳以 id 為鍵的新量體，高程不變。
 */
export function alignHandovers(osm: Feature[], dorts: Feature[]): Map<string, Feature> {
  const candidates = osm.filter(
    (f) => f.kind === "track-metro" && !f.id.startsWith("dorts/") && (f.geometry.polyline?.length ?? 0) >= 2,
  );
  const aligned = new Map<string, Feature>();
  const latest = (f: Feature): Feature => aligned.get(f.id) ?? f;
  const oriented = (f: Feature, reversed: boolean): OrientedPiece => {
    const pts = latest(f).geometry.polyline as Local[];
    return { feature: latest(f), pts: reversed ? [...pts].reverse() : pts, reversed };
  };
  const handled = new Set<string>();
  for (const track of dorts) {
    const line = track.geometry.polyline;
    if (track.kind !== "track-metro" || !line || line.length < 2) continue;
    for (const end of [line[0], line[line.length - 1]]) {
      let best: { feature: Feature; atStart: boolean; distance: number } | undefined;
      for (const candidate of candidates) {
        if (candidate.line !== track.line) continue;
        const pts = latest(candidate).geometry.polyline as Local[];
        for (const atStart of [true, false]) {
          if (handled.has(`${candidate.id}|${atStart}`)) continue;
          const distance = dist(atStart ? pts[0] : pts[pts.length - 1], end);
          if (distance <= HANDOVER_REACH && (!best || distance < best.distance)) {
            best = { feature: candidate, atStart, distance };
          }
        }
      }
      if (!best) continue;
      handled.add(`${best.feature.id}|${best.atStart}`);
      if (best.distance < HANDOVER_JOINED) continue;

      // 末段方向上的縱向與左側偏移；OSM 端點越過公告圖端點時先截短，免得末點折返
      const last = oriented(best.feature, best.atStart);
      const [a, b] = [last.pts[last.pts.length - 2], last.pts[last.pts.length - 1]];
      const [ux, uy] = [(b[0] - a[0]) / dist(a, b), (b[1] - a[1]) / dist(a, b)];
      const along = ux * (end[0] - b[0]) + uy * (end[1] - b[1]);
      const offset = ux * (end[1] - b[1]) - uy * (end[0] - b[0]);
      const lastLength = polylineLength(last.pts);
      if (along < 0 && lastLength + along > 1) last.pts = slicePolyline(last.pts, 0, lastLength + along);

      // 自交接端往回串接首尾相接的同路線段落，湊足漸移長度
      const path: OrientedPiece[] = [last];
      let length = polylineLength(last.pts);
      while (length < HANDOVER_TAPER) {
        const head = path[0].pts[0];
        const previous = candidates.find((c) => {
          if (c.line !== track.line || path.some((p) => p.feature.id === c.id)) return false;
          const pts = latest(c).geometry.polyline as Local[];
          return dist(pts[0], head) < PIECE_JOIN || dist(pts[pts.length - 1], head) < PIECE_JOIN;
        });
        if (!previous) break;
        const pts = latest(previous).geometry.polyline as Local[];
        const piece = oriented(previous, dist(pts[pts.length - 1], head) >= PIECE_JOIN);
        path.unshift(piece);
        length += polylineLength(piece.pts);
      }

      // 串成一條加密後漸移，再依各段的頂點數拆回
      const start = Math.max(0, length - HANDOVER_TAPER);
      const joined: Local[] = [];
      const counts: number[] = [];
      let walked = 0;
      for (const piece of path) {
        const dense = densifyAfter(piece.pts, start - walked);
        joined.push(...(joined.length === 0 ? dense : dense.slice(1)));
        counts.push(dense.length);
        walked += polylineLength(piece.pts);
      }
      // 漸移式同 `taperedOffset`（3u²−2u³）；法向取前後各 1 公尺的弦，
      // 段落交界的重合頂點才不會因相鄰頂點不同而各自偏向
      const cumulative = arcLengths(joined);
      const shifted = joined.map((p, i): Local => {
        const u = Math.min(1, Math.max(0, (cumulative[i] - start) / (length - start)));
        if (u === 0) return p;
        const e = offset * u * u * (3 - 2 * u);
        const a = pointAtArc(joined, cumulative, cumulative[i] - 1);
        const b = pointAtArc(joined, cumulative, cumulative[i] + 1);
        const chord = dist(a, b) || 1;
        return [p[0] - ((b[1] - a[1]) / chord) * e, p[1] + ((b[0] - a[0]) / chord) * e];
      });
      shifted[shifted.length - 1] = end;
      let index = 0;
      path.forEach((piece, k) => {
        const pts = shifted.slice(index, index + counts[k]);
        index += counts[k] - 1;
        if (piece.reversed) pts.reverse();
        aligned.set(piece.feature.id, {
          ...piece.feature,
          geometry: { ...piece.feature.geometry, polyline: pts },
        });
      });
    }
  }
  return aligned;
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
