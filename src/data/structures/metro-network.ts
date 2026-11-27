/**
 * 捷運路網：每條路線每個行車方向一條連續的正線，加上逐條列明銜接對象的配線
 * （渡線、聯絡線、中線折返軌、側線、機廠線）。
 *
 * 正線的平面：公告圖的軌道中心線是繪圖筆畫，一筆常自正線經渡線畫到另一條正線，
 * 疊式段兩軌在平面上重合時也只畫一筆。筆畫因此先在交會點與重合段的界線切開，
 * 各段再依頂點到各正線鏈（OSM）的距離中位數歸屬：斜穿兩軌之間的渡線段、配線段與
 * 離鏈過遠者不採用，疊式段同時歸屬上下兩條正線。各鏈依側距由小到大取用不重疊的段落，
 * 段落之間與公告圖未涵蓋處取 OSM 正線並漸移銜接，每 {@link STEP} 公尺重取樣後平滑；
 * 平滑偏移不超過 {@link SMOOTH_LIMIT} 公尺，曲率不低於捷運工程叢書精進版 9 表 2-3-1 的下限。
 *
 * 正線的高程依 `metro-profile.ts` 的縱斷面；配線的端點移到所銜接軌道上，高程取自該軌道。
 */
import { resample } from "../../geo/corridor.ts";
import { nearestOnPolyline } from "../../geo/measure.ts";
import { slicePolyline } from "../../geo/offset.ts";
import type { Local } from "../../geo/project.ts";
import { dortsTrackPolylines } from "../dorts.ts";
import { elevationAt } from "../elevation.ts";
import { METRO_LINES, levelLabelFor, railLevelOf, type MetroLineId } from "../levels.ts";
import { TRACK_BAND_THICKNESS, TRACK_BAND_WIDTH, type Feature } from "../schema.ts";
import {
  METRO_CHAINS,
  PROFILE_NOTE,
  STEEP_GRADE,
  arcLengths,
  chainControls,
  joinChain,
  nearestArc,
  osmFeature,
  osmPolyline,
  pointAtArc,
  profileOf,
  type MetroChain,
} from "./metro-profile.ts";

/** 筆畫切段：其他筆畫的端點距本筆畫此值以內即為交會點（公尺）。 */
const JUNCTION_REACH = 1.0;
/** 筆畫切段：兩筆畫相距此值以內、連續達 {@link COINCIDE_MIN} 即為重合段（公尺）。 */
const COINCIDE_REACH = 1.0;
const COINCIDE_MIN = 20;
/** 相距小於此值的切點併為一個（公尺）。 */
const CUT_MERGE = 2;
/** 短於此值的筆畫段捨棄（公尺）。 */
const MIN_PIECE = 1;
/** 頂點間距與重取樣間距（公尺）。 */
const STEP = 2;
/** 筆畫段到最近正線鏈的距離中位數上限（公尺）。 */
const PIECE_REACH = 7.0;
/** 筆畫段離某條配線比離最近正線鏈近此值以上，即視為配線（公尺）。 */
const LINK_MARGIN = 1.0;
/** 斜線判定：沿筆畫相距 {@link BEND_SPAN} 公尺以內的兩點，側距差超過 {@link BEND_LIMIT} 即為斜穿。 */
const BEND_SPAN = 30;
const BEND_LIMIT = 3.5;
/** 疊式段：筆畫段到同路線另一條鏈的距離中位數不超過最近者加此值，即同屬兩條正線（公尺）。 */
const TWIN_MARGIN = 1.5;
/** 去除重疊後保留的段落最短長度（公尺）。 */
const MIN_RUN = 20;
/** 兩段公告圖之間短於此值者，以線性內插的平移銜接（公尺）。 */
const BLEND_GAP = 120;
/** 公告圖段落與 OSM 正線交接的漸移長度（公尺）。 */
const TAPER = 60;
/** 移動平均的半窗（取樣點數）與次數。 */
const SMOOTH_HALF = 5;
const SMOOTH_PASSES = 3;
/** 平滑造成的最大偏移（公尺）。 */
const SMOOTH_LIMIT = 1.0;
/** 配線端點移到所銜接軌道的距離上限（公尺）。 */
const LINK_SNAP = 8;
/** 縱斷面轉折點與既有頂點視為重合的距離（公尺）。 */
const VERTEX_MERGE = 0.01;

/**
 * 不採用的公告圖筆畫段：經過下列各點 1 公尺內者。
 * 目前為空：現行資料的歸屬判準已排除全部渡線與配線段。
 */
const DORTS_EXCLUDE: Local[] = [];

/** 機場捷運的兩條正線：A1 為端點站，不標行車方向。 */
const AIRPORT_MAINS: { id: string; name: string; ways: string[] }[] = [
  { id: "metro/a/north", name: "機場捷運北側正線", ways: ["way/1558102739", "way/170432840"] },
  { id: "metro/a/south", name: "機場捷運南側正線", ways: ["way/1558102738", "way/198163706"] },
];

/** 機場捷運軌道面：沿用 A1 車站 B3。 */
const AIRPORT_RAIL = railLevelOf("airport-mrt-a1", "B3");

type LinkKind = "crossover" | "connector" | "pocket" | "siding" | "yard";

const KIND_LABEL: Record<LinkKind, string> = {
  crossover: "渡線",
  connector: "聯絡線",
  pocket: "中線折返軌",
  siding: "側線",
  yard: "機廠線",
};

/**
 * 配線：`joins` 依 OSM way 的頂點順序列出首、末端銜接的軌道。
 * `linear` 依兩端軌道面線性內插、`mains` 逐點取兩條正線的平均、`flat` 為機場捷運軌道面。
 */
interface LinkSpec {
  id: string;
  way: string;
  line: MetroLineId;
  kind: LinkKind;
  joins: [string | null, string | null];
  profile: "linear" | "mains" | "flat";
}

const XIMEN_SPLIT_NOTE =
  "OSM 只畫一條，依使用者提供的配置拆為上下兩層：往松山↔往南港展覽館、往新店↔往頂埔。";

const LINKS: LinkSpec[] = [
  { id: "way/877532234", way: "way/877532234", line: "bl", kind: "crossover", joins: ["metro/bl/to-nangang", "metro/bl/to-dingpu"], profile: "linear" },
  { id: "way/877532235", way: "way/877532235", line: "bl", kind: "crossover", joins: ["metro/bl/to-dingpu", "metro/bl/to-nangang"], profile: "linear" },
  { id: "way/194585055/upper", way: "way/194585055", line: "g", kind: "connector", joins: ["metro/g/to-songshan", "metro/bl/to-nangang"], profile: "linear" },
  { id: "way/194585055/lower", way: "way/194585055", line: "g", kind: "connector", joins: ["metro/g/to-xindian", "metro/bl/to-dingpu"], profile: "linear" },
  { id: "way/871168310", way: "way/871168310", line: "g", kind: "crossover", joins: ["metro/g/to-xindian", "metro/g/to-songshan"], profile: "linear" },
  { id: "way/871168311", way: "way/871168311", line: "g", kind: "crossover", joins: ["metro/g/to-xindian", "metro/g/to-songshan"], profile: "linear" },
  { id: "way/871168314", way: "way/871168314", line: "g", kind: "crossover", joins: ["metro/g/to-xindian", "metro/g/to-songshan"], profile: "linear" },
  { id: "way/871168315", way: "way/871168315", line: "g", kind: "crossover", joins: ["metro/g/to-songshan", "metro/g/to-xindian"], profile: "linear" },
  { id: "way/194618354", way: "way/194618354", line: "r", kind: "connector", joins: ["metro/g/to-songshan", "metro/r/to-tamsui"], profile: "linear" },
  { id: "way/266862893", way: "way/266862893", line: "r", kind: "connector", joins: ["metro/r/to-xiangshan", "metro/g/to-xindian"], profile: "linear" },
  { id: "way/1226066660", way: "way/1226066660", line: "r", kind: "pocket", joins: ["metro/r/to-xiangshan", "way/1226066661"], profile: "mains" },
  { id: "way/1226066661", way: "way/1226066661", line: "r", kind: "pocket", joins: ["metro/r/to-xiangshan", "way/1226066660"], profile: "mains" },
  { id: "way/1226066662", way: "way/1226066662", line: "r", kind: "pocket", joins: ["metro/r/to-tamsui", "way/1226066660"], profile: "mains" },
  { id: "way/1226066663", way: "way/1226066663", line: "r", kind: "crossover", joins: ["way/1226066660", "metro/r/to-tamsui"], profile: "mains" },
  // OSM 的首端節點不與任何軌道相接，位於兩條正線之間：中線折返軌南端的止衝段，不是渡線
  { id: "way/1226066664", way: "way/1226066664", line: "r", kind: "pocket", joins: [null, "way/1226066660"], profile: "mains" },
  { id: "way/871168312", way: "way/871168312", line: "o", kind: "crossover", joins: ["metro/o/to-nanshijiao", "metro/o/to-luzhou"], profile: "linear" },
  { id: "way/871168313", way: "way/871168313", line: "o", kind: "crossover", joins: ["metro/o/to-nanshijiao", "metro/o/to-luzhou"], profile: "linear" },
  { id: "way/619251066", way: "way/619251066", line: "a", kind: "crossover", joins: ["metro/a/north", "metro/a/south"], profile: "flat" },
  { id: "way/619251067", way: "way/619251067", line: "a", kind: "crossover", joins: ["metro/a/north", "metro/a/south"], profile: "flat" },
  { id: "way/619251068", way: "way/619251068", line: "a", kind: "siding", joins: [null, "metro/a/south"], profile: "flat" },
  { id: "way/619251069", way: "way/619251069", line: "a", kind: "siding", joins: [null, "metro/a/north"], profile: "flat" },
  { id: "way/748971523", way: "way/748971523", line: "a", kind: "yard", joins: [null, null], profile: "flat" },
  { id: "way/871105040", way: "way/871105040", line: "a", kind: "yard", joins: [null, null], profile: "flat" },
];

/** 不納入路網的 OSM 捷運軌道與理由。 */
export const EXCLUDED_WAYS: Record<string, string> = {
  "way/194585047": "西門地下街下方的 OSM 渡線：使用者確認現況不存在",
};

/** 路網採用的全部 OSM way：正線鏈、機場捷運正線與配線。 */
export const NETWORK_WAY_IDS: Set<string> = new Set([
  ...METRO_CHAINS.flatMap((chain) => chain.ways),
  ...AIRPORT_MAINS.flatMap((main) => main.ways),
  ...LINKS.map((link) => link.way),
]);

const MAIN_NOTE =
  "平面取禁限建公告圖軌道中心線，未涵蓋處取 OSM 並以 60 公尺漸移銜接，" +
  "每 2 公尺重取樣後平滑（偏移不超過 1 公尺）；" +
  "行車方向依右側行車與維基百科〈西門站〉〈中正紀念堂站〉的月台配置。";

const AIRPORT_NOTE =
  "平面取 OSM，每 2 公尺重取樣後平滑（偏移不超過 1 公尺）；高程沿用 A1 車站 B3 軌道面；A1 為端點站，不標行車方向。";

const LINK_NOTE = "OSM 配線幾何，端點移至所銜接軌道；高程依兩端軌道面（或兩側正線）推得。";

const dist = (a: Local, b: Local): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

type Bounds = [number, number, number, number];

function boundsOf(points: Local[]): Bounds {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
}

const near = (a: Bounds, b: Bounds, pad: number): boolean =>
  a[0] <= b[2] + pad && b[0] <= a[2] + pad && a[1] <= b[3] + pad && b[1] <= a[3] + pad;
const inside = (b: Bounds, [x, y]: Local, pad: number): boolean =>
  x >= b[0] - pad && x <= b[2] + pad && y >= b[1] - pad && y <= b[3] + pad;

/** 點在折線上的投影：距離、弧長與側距（左正右負）。 */
function project(points: Local[], cumulative: number[], p: Local): { distance: number; arc: number; offset: number } {
  let best = { distance: Infinity, arc: 0, offset: 0 };
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const [vx, vy] = [b[0] - a[0], b[1] - a[1]];
    const len2 = vx * vx + vy * vy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2));
    const distance = Math.hypot(a[0] + vx * t - p[0], a[1] + vy * t - p[1]);
    if (distance < best.distance) {
      const side = vx * (p[1] - a[1]) - vy * (p[0] - a[0]) >= 0 ? 1 : -1;
      best = { distance, arc: cumulative[i - 1] + t * Math.sqrt(len2), offset: side * distance };
    }
  }
  return best;
}

/** 等距重取樣：`n` 等分全長，首末點不變。 */
function uniform(points: Local[], step: number): Local[] {
  const cumulative = arcLengths(points);
  const total = cumulative[cumulative.length - 1];
  const n = Math.max(1, Math.ceil(total / step));
  const out: Local[] = [];
  let i = 1;
  for (let k = 0; k <= n; k++) {
    const s = (total * k) / n;
    while (i < points.length - 1 && cumulative[i] < s) i++;
    const span = cumulative[i] - cumulative[i - 1];
    const t = span > 0 ? Math.min(1, Math.max(0, (s - cumulative[i - 1]) / span)) : 0;
    const [a, b] = [points[i - 1], points[i]];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  out[0] = points[0];
  out[out.length - 1] = points[points.length - 1];
  return out;
}

/** 公告圖筆畫在交會點與重合段界線切開後的各段，每段頂點間距不超過 {@link STEP}。 */
function strokePieces(): Local[][] {
  const strokes = dortsTrackPolylines();
  const boxes = strokes.map(boundsOf);
  const pieces: Local[][] = [];
  strokes.forEach((a, i) => {
    const cumulative = arcLengths(a);
    const length = cumulative[cumulative.length - 1];
    const interior = (s: number): boolean => s > JUNCTION_REACH && s < length - JUNCTION_REACH;
    const dense = resample(a, STEP);
    const denseArcs = arcLengths(dense);
    const cuts: number[] = [];
    strokes.forEach((b, j) => {
      if (i === j || !near(boxes[i], boxes[j], JUNCTION_REACH)) return;
      for (const end of [b[0], b[b.length - 1]]) {
        const hit = nearestArc(a, cumulative, end);
        if (hit.distance <= JUNCTION_REACH && interior(hit.arc)) cuts.push(hit.arc);
      }
      let start = -1;
      for (let k = 0; k <= dense.length; k++) {
        const close =
          k < dense.length &&
          inside(boxes[j], dense[k], COINCIDE_REACH) &&
          nearestOnPolyline(dense[k], b).distance <= COINCIDE_REACH;
        if (close && start < 0) start = k;
        if (close || start < 0) continue;
        const [s0, s1] = [denseArcs[start], denseArcs[k - 1]];
        if (s1 - s0 >= COINCIDE_MIN) cuts.push(...[s0, s1].filter(interior));
        start = -1;
      }
    });
    cuts.sort((x, y) => x - y);
    const merged: number[] = [];
    for (const cut of cuts) if (merged.length === 0 || cut - merged[merged.length - 1] >= CUT_MERGE) merged.push(cut);
    const bounds = [0, ...merged, length];
    for (let k = 0; k + 1 < bounds.length; k++) {
      if (bounds[k + 1] - bounds[k] < MIN_PIECE) continue;
      pieces.push(resample(slicePolyline(a, bounds[k], bounds[k + 1]), STEP));
    }
  });
  return pieces;
}

/** 正線鏈的 OSM 折線。 */
interface ChainLine {
  points: Local[];
  cumulative: number[];
  bounds: Bounds;
}

function chainLine(ways: string[]): ChainLine {
  const { points } = joinChain(ways, osmPolyline);
  return { points, cumulative: arcLengths(points), bounds: boundsOf(points) };
}

/** 歸屬於某條鏈的公告圖段落：已沿鏈的方向排列，`arcs` 為各頂點投影到鏈上的弧長。 */
interface Run {
  points: Local[];
  arcs: number[];
  s0: number;
  s1: number;
  /** 側距中位數（左正右負）。 */
  offset: number;
}

/** 斜穿判定：沿段落 {@link BEND_SPAN} 公尺以內的兩點，側距差超過 {@link BEND_LIMIT}。 */
function bends(piece: Local[], offsets: number[]): boolean {
  const arcs = arcLengths(piece);
  for (let i = 0; i < piece.length; i++) {
    for (let j = i + 1; j < piece.length && arcs[j] - arcs[i] <= BEND_SPAN; j++) {
      if (Math.abs(offsets[j] - offsets[i]) > BEND_LIMIT) return true;
    }
  }
  return false;
}

/** 公告圖段落依各鏈歸屬；回傳與 {@link METRO_CHAINS} 同序的段落清單。 */
function assignRuns(chains: ChainLine[]): Run[][] {
  const links = [...new Set(LINKS.map((link) => link.way))].map((way) => osmPolyline(way));
  const runs: Run[][] = chains.map(() => []);
  for (const piece of strokePieces()) {
    if (DORTS_EXCLUDE.some((p) => nearestOnPolyline(p, piece).distance <= 1)) continue;
    const box = boundsOf(piece);
    const projections = chains.map((chain) =>
      near(box, chain.bounds, PIECE_REACH + TWIN_MARGIN)
        ? piece.map((p) => project(chain.points, chain.cumulative, p))
        : null,
    );
    const medians = projections.map((hits) => (hits ? median(hits.map((h) => h.distance)) : Infinity));
    const best = medians.indexOf(Math.min(...medians));
    if (!(medians[best] <= PIECE_REACH)) continue;
    const linkMedian = Math.min(
      ...links.map((link) => median(piece.map((p) => nearestOnPolyline(p, link).distance))),
    );
    if (linkMedian < medians[best] - LINK_MARGIN) continue;
    const bestHits = projections[best] as { offset: number }[];
    if (bends(piece, bestHits.map((h) => h.offset))) continue;

    const owners = [best];
    METRO_CHAINS.forEach((chain, k) => {
      if (k !== best && chain.line === METRO_CHAINS[best].line && medians[k] - medians[best] <= TWIN_MARGIN) owners.push(k);
    });
    for (const owner of owners) {
      const hits = projections[owner] as { arc: number; offset: number }[];
      const reversed = hits[0].arc > hits[hits.length - 1].arc;
      const points = reversed ? [...piece].reverse() : piece;
      const ordered = reversed ? [...hits].reverse() : hits;
      const arcs = ordered.map((h) => h.arc);
      runs[owner].push({
        points,
        arcs,
        s0: arcs[0],
        s1: arcs[arcs.length - 1],
        offset: median(ordered.filter((_, i) => i % 5 === 0).map((h) => h.offset)),
      });
    }
  }
  return runs;
}

/** 依側距由小到大、等側距取較長者，取用與已取段落不重疊的部分。 */
function acceptRuns(runs: Run[]): Run[] {
  const sorted = [...runs].sort(
    (a, b) => Math.round(Math.abs(a.offset)) - Math.round(Math.abs(b.offset)) || b.s1 - b.s0 - (a.s1 - a.s0),
  );
  const accepted: Run[] = [];
  for (const run of sorted) {
    const free = run.arcs.map((s) => !accepted.some((r) => s >= r.s0 && s <= r.s1));
    let best: [number, number] | null = null;
    for (let i = 0; i < free.length; ) {
      if (!free[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < free.length && free[j + 1]) j++;
      if (best === null || run.arcs[j] - run.arcs[i] > run.arcs[best[1]] - run.arcs[best[0]]) best = [i, j];
      i = j + 1;
    }
    if (best === null || run.arcs[best[1]] - run.arcs[best[0]] < MIN_RUN) continue;
    const [i, j] = best;
    accepted.push({
      points: run.points.slice(i, j + 1),
      arcs: run.arcs.slice(i, j + 1),
      s0: run.arcs[i],
      s1: run.arcs[j],
      offset: run.offset,
    });
  }
  return accepted.sort((a, b) => a.s0 - b.s0);
}

/**
 * 正線的平面：公告圖段落之間取 OSM 正線，平移到兩端段落的端點。
 * 兩端皆有段落且間距短於 {@link BLEND_GAP} 時平移量線性內插，否則各端的平移量在 {@link TAPER} 公尺內遞減到零。
 */
function stitch(chain: ChainLine, runs: Run[]): Local[] {
  const { points, cumulative } = chain;
  const total = cumulative[cumulative.length - 1];
  const out: Local[] = [];
  const push = (p: Local): void => {
    if (out.length === 0 || dist(out[out.length - 1], p) > 1e-6) out.push(p);
  };
  const shiftAt = (run: Run, end: 0 | 1): Local => {
    const p = end === 0 ? run.points[0] : run.points[run.points.length - 1];
    const q = pointAtArc(points, cumulative, end === 0 ? run.s0 : run.s1);
    return [p[0] - q[0], p[1] - q[1]];
  };
  for (let k = 0; k <= runs.length; k++) {
    const prev = k > 0 ? runs[k - 1] : null;
    const next = k < runs.length ? runs[k] : null;
    const g0 = prev ? prev.s1 : 0;
    const g1 = next ? next.s0 : total;
    if (g1 - g0 > 1e-6) {
      const d0: Local = prev ? shiftAt(prev, 1) : [0, 0];
      const d1: Local = next ? shiftAt(next, 0) : [0, 0];
      const blend = prev !== null && next !== null && g1 - g0 < BLEND_GAP;
      const gap = resample(slicePolyline(points, g0, g1), STEP);
      const gapArcs = arcLengths(gap);
      gap.forEach((p, i) => {
        const s = gapArcs[i];
        const f = gapArcs[gapArcs.length - 1] > 0 ? s / gapArcs[gapArcs.length - 1] : 0;
        const w0 = blend ? 1 - f : Math.max(0, 1 - s / TAPER);
        const w1 = blend ? f : Math.max(0, 1 - (g1 - g0 - s) / TAPER);
        push([p[0] + d0[0] * w0 + d1[0] * w1, p[1] + d0[1] * w0 + d1[1] * w1]);
      });
    }
    if (next) for (const p of next.points) push(p);
  }
  return out;
}

/** 每 {@link STEP} 公尺重取樣後做 {@link SMOOTH_PASSES} 次置中移動平均；回傳平滑後的折線與最大偏移。 */
function smooth(points: Local[]): { points: Local[]; shift: number } {
  const base = uniform(points, STEP);
  const n = base.length;
  let current = base;
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    current = current.map((_, i) => {
      const half = Math.min(SMOOTH_HALF, i, n - 1 - i);
      let [x, y] = [0, 0];
      for (let k = i - half; k <= i + half; k++) {
        x += current[k][0];
        y += current[k][1];
      }
      return [x / (2 * half + 1), y / (2 * half + 1)] as Local;
    });
  }
  const shift = Math.max(...current.map((p, i) => dist(p, base[i])));
  return { points: current, shift };
}

/** 依行車方向排列：末點須比首點更偏向 `ends`。 */
function orient(points: Local[], ends: MetroChain["ends"]): Local[] {
  const [first, last] = [points[0], points[points.length - 1]];
  const forward =
    ends === "east" ? last[0] > first[0] : ends === "west" ? last[0] < first[0] : ends === "north" ? last[1] > first[1] : last[1] < first[1];
  return forward ? points : [...points].reverse();
}

/** 在縱斷面轉折點補上頂點，回傳頂點與各點高程。 */
export function profiled(points: Local[], controls: [number, number][]): { points: Local[]; elevations: number[] } {
  const elevationOf = profileOf(controls);
  let cumulative = arcLengths(points);
  const out = [...points];
  for (const [arc] of controls) {
    if (cumulative.some((s) => Math.abs(s - arc) <= VERTEX_MERGE)) continue;
    const at = cumulative.findIndex((s) => s > arc);
    if (at <= 0) continue;
    out.splice(at, 0, pointAtArc(out, cumulative, arc));
    cumulative = arcLengths(out);
  }
  return { points: out, elevations: cumulative.map(elevationOf) };
}

interface Network {
  features: Feature[];
  diagnostics: { id: string; dortsLength: number; maxSmoothingShift: number }[];
}

let cached: Network | null = null;

function mainFeature(
  id: string,
  line: MetroLineId,
  name: string,
  points: Local[],
  elevations: number[],
  sourceNote: string,
): Feature {
  return {
    id,
    kind: "track-metro",
    name,
    level: levelLabelFor(Math.min(...elevations)),
    structure: METRO_LINES[line].structure,
    line,
    layer: "metro",
    geometry: { polyline: points },
    elevations,
    base: elevations[0],
    height: TRACK_BAND_THICKNESS,
    width: TRACK_BAND_WIDTH,
    confidence: "estimated",
    sourceNote,
    status: "existing",
    trackRole: "main",
  };
}

/** 正線：公告圖段落與 OSM 補足、平滑、依行車方向排列，再依縱斷面給出各點高程。 */
function buildMains(diagnostics: Network["diagnostics"]): Feature[] {
  const chains = METRO_CHAINS.map((chain) => chainLine(chain.ways));
  const assigned = assignRuns(chains);
  const mains = METRO_CHAINS.map((chain, k) => {
    const runs = acceptRuns(assigned[k]);
    const { points: smoothed, shift } = smooth(stitch(chains[k], runs));
    if (shift > SMOOTH_LIMIT) throw new Error(`正線 ${chain.id} 平滑偏移 ${shift.toFixed(2)} 公尺超過 1 公尺`);
    const oriented = orient(smoothed, chain.ends);
    const { points, elevations } = profiled(oriented, chainControls(chain, oriented));
    diagnostics.push({
      id: chain.id,
      dortsLength: runs.reduce((sum, run) => sum + run.s1 - run.s0, 0),
      maxSmoothingShift: shift,
    });
    const name = `捷運${METRO_LINES[chain.line].label}往${chain.toward}正線`;
    return mainFeature(chain.id, chain.line, name, points, elevations, `${PROFILE_NOTE}${MAIN_NOTE}`);
  });
  const airport = AIRPORT_MAINS.map((main) => {
    const { points: smoothed, shift } = smooth(stitch(chainLine(main.ways), []));
    if (shift > SMOOTH_LIMIT) throw new Error(`正線 ${main.id} 平滑偏移 ${shift.toFixed(2)} 公尺超過 1 公尺`);
    const points = orient(smoothed, "east");
    diagnostics.push({ id: main.id, dortsLength: 0, maxSmoothingShift: shift });
    return mainFeature(main.id, "a", main.name, points, points.map(() => AIRPORT_RAIL), AIRPORT_NOTE);
  });
  return [...mains, ...airport];
}

/**
 * 配線：端點移到所銜接軌道上，內部頂點依弧長比例平移；高程依 `profile`。
 * `deferred` 為尚未建立的配線：互相銜接的配線（中線折返軌的共用節點）先建者該端不移動，
 * 後建者再移到先建者的端點上。
 */
function buildLink(link: LinkSpec, tracks: Map<string, Feature>, deferred: Set<string>): Feature {
  const osm = resample(osmPolyline(link.way), STEP);
  const ends = [osm[0], osm[osm.length - 1]];
  const snaps = link.joins.map((join, n) => {
    if (join === null || deferred.has(join)) return null;
    const track = tracks.get(join);
    if (!track) throw new Error(`配線 ${link.id} 銜接的 ${join} 尚未建立`);
    const line = track.geometry.polyline as Local[];
    const cumulative = arcLengths(line);
    const { distance, arc } = nearestArc(line, cumulative, ends[n]);
    if (distance > LINK_SNAP) throw new Error(`配線 ${link.id} 端點距 ${join} ${distance.toFixed(2)} 公尺`);
    const foot = pointAtArc(line, cumulative, arc);
    return { foot, delta: [foot[0] - ends[n][0], foot[1] - ends[n][1]] as Local, elevation: elevationAt(track)(arc) };
  });
  const arcs = arcLengths(osm);
  const total = arcs[arcs.length - 1];
  const points = osm.map((p, i): Local => {
    if (i === 0 && snaps[0]) return snaps[0].foot;
    if (i === osm.length - 1 && snaps[1]) return snaps[1].foot;
    const f = total > 0 ? arcs[i] / total : 0;
    const [d0, d1] = [snaps[0]?.delta ?? [0, 0], snaps[1]?.delta ?? [0, 0]];
    return [p[0] + (1 - f) * d0[0] + f * d1[0], p[1] + (1 - f) * d0[1] + f * d1[1]];
  });

  let elevations: number[];
  if (link.profile === "flat") {
    elevations = points.map(() => AIRPORT_RAIL);
  } else if (link.profile === "linear") {
    const e0 = snaps[0]?.elevation ?? snaps[1]?.elevation;
    const e1 = snaps[1]?.elevation ?? e0;
    if (e0 === undefined || e1 === undefined) throw new Error(`配線 ${link.id} 兩端皆不銜接，無從推得高程`);
    const cumulative = arcLengths(points);
    const length = cumulative[cumulative.length - 1];
    elevations = cumulative.map((s) => (length > 0 ? e0 + ((e1 - e0) * s) / length : e0));
  } else {
    const mains = [...tracks.values()].filter((t) => t.trackRole === "main" && t.line === link.line);
    if (mains.length !== 2) throw new Error(`配線 ${link.id} 找不到 ${link.line} 的兩條正線`);
    const profiles = mains.map((main) => {
      const line = main.geometry.polyline as Local[];
      return { line, cumulative: arcLengths(line), at: elevationAt(main) };
    });
    elevations = points.map((p, i) => {
      const snap = i === 0 ? snaps[0] : i === points.length - 1 ? snaps[1] : null;
      if (snap) return snap.elevation;
      return profiles.reduce((sum, m) => sum + m.at(nearestArc(m.line, m.cumulative, p).arc), 0) / profiles.length;
    });
  }
  for (let i = 1; i < points.length; i++) {
    const run = dist(points[i - 1], points[i]);
    if (run > 0 && Math.abs(elevations[i] - elevations[i - 1]) / run > STEEP_GRADE + 1e-9) {
      throw new Error(`配線 ${link.id} 在 (${points[i].map((v) => v.toFixed(1))}) 的坡度超過 ${STEEP_GRADE}`);
    }
  }

  const line = METRO_LINES[link.line];
  return {
    id: link.id,
    kind: "track-metro",
    // 機場捷運的路線名已含「捷運」
    name: osmFeature(link.way).name ?? `${link.line === "a" ? "" : "捷運"}${line.label}${KIND_LABEL[link.kind]}`,
    level: levelLabelFor(Math.min(...elevations)),
    structure: line.structure,
    line: link.line,
    layer: "metro",
    geometry: { polyline: points },
    elevations,
    base: elevations[0],
    height: TRACK_BAND_THICKNESS,
    width: TRACK_BAND_WIDTH,
    confidence: "estimated",
    sourceNote: link.way === "way/194585055" ? `${LINK_NOTE}${XIMEN_SPLIT_NOTE}` : LINK_NOTE,
    status: "existing",
    trackRole: link.kind,
    joins: link.joins,
  };
}

function build(): Network {
  if (cached) return cached;
  const diagnostics: Network["diagnostics"] = [];
  const tracks = new Map(buildMains(diagnostics).map((f) => [f.id, f]));
  // 銜接配線的配線須待被銜接者建立後再處理
  const pending = [...LINKS];
  while (pending.length > 0) {
    let ready = pending.findIndex((link) => link.joins.every((join) => join === null || tracks.has(join)));
    const deferred = new Set<string>();
    if (ready < 0) {
      // 互相銜接的配線：取第一條銜接對象皆已建立或尚待建立的配線，待建立的一端暫不移動
      const waiting = new Set(pending.map((link) => link.id));
      ready = pending.findIndex((link) => link.joins.every((j) => j === null || tracks.has(j) || waiting.has(j)));
      if (ready < 0) throw new Error(`配線 ${pending.map((l) => l.id).join("、")} 的銜接對象無法建立`);
      for (const join of pending[ready].joins) if (join !== null && waiting.has(join)) deferred.add(join);
    }
    const [link] = pending.splice(ready, 1);
    tracks.set(link.id, buildLink(link, tracks, deferred));
  }
  cached = { features: [...tracks.values()], diagnostics };
  return cached;
}

/** 路網的全部軌道量體（未裁切）：正線與配線。 */
export function buildMetroNetwork(): Feature[] {
  return build().features;
}

/** 各正線的公告圖採用長度與平滑的最大偏移（公尺）。 */
export function networkDiagnostics(): { id: string; dortsLength: number; maxSmoothingShift: number }[] {
  return build().diagnostics;
}
