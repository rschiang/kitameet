/**
 * 捷運結構的量體化。
 *
 * 公告圖只畫結構外緣與軌道中心線，沒有斷面。作法是沿軌道中心線等距取樣，
 * 向兩側投射法線射線量到結構外緣，由淨寬判定該段是潛盾（圓形隧道）或明挖／車站（箱形），
 * 再把連續同類的取樣合併成一段。結構外緣本身不輸出，只作為射線標的。
 */
import { chainSegments, dedupeSegments } from "../../src/geo/chain.ts";
import { medianFilter, rayHit, resample } from "../../src/geo/corridor.ts";
import { polygonArea, polygonAxis, pointInPolygon } from "../../src/geo/measure.ts";
import type { Local } from "../../src/geo/project.ts";
import type { DortsLineCode } from "../../src/data/dorts-types.ts";
import type { SheetGeometry } from "./sheet.ts";

/** 射線上限（公尺）：超過此距離的交點必非本條隧道的外緣。 */
const RAY_LIMIT = 45;
/** 取樣間距（公尺）。 */
const SAMPLE_STEP = 4;
/** 寬度序列的中位數濾波視窗（取樣點數）。 */
const WIDTH_WINDOW = 7;
/** 淨寬不大於此值者視為潛盾段（公尺）。 */
const BORE_MAX_WIDTH = 8;
/** 短於此長度的段併入相鄰段（公尺）。 */
const MIN_RUN_LENGTH = 20;
/** 潛盾段半徑的夾限（公尺）。 */
const BORE_RADIUS = { min: 2.5, max: 4.0 };
/** 粗虛線的單一線劃尺寸上限（公尺）。 */
const DASH = { length: 12, width: 2 };
/** 箱形段重疊判定：取樣中心落在另一段多邊形內的比例門檻。 */
const BOX_OVERLAP = 0.8;
/** 單側偏移相對該段中位數的上限倍率；出入口、通風井等外凸仍在此範圍內。 */
const OFFSET_CLAMP = 2.0;

export type TunnelShape =
  | { lineCode: DortsLineCode; kind: "bore"; line: Local[]; radius: number }
  | { lineCode: DortsLineCode; kind: "box"; polygon: Local[]; width: number };

export interface LineGeometry {
  lineCode: DortsLineCode;
  line: Local[];
}

export interface BuiltStructures {
  tunnels: TunnelShape[];
  tracks: LineGeometry[];
  restrictionLines: LineGeometry[];
  /** 限建線到最近結構外緣的距離取樣（公尺），供品質報告驗算 50 公尺。 */
  restrictionOffsets: number[];
}

type Segment = [Local, Local];

/** 以 50 公尺格網索引線段，供射線與最近距離查詢取候選。 */
class SegmentIndex {
  private readonly cell = 50;
  private readonly buckets = new Map<string, Segment[]>();

  constructor(segments: Segment[]) {
    for (const seg of segments) {
      const minX = Math.min(seg[0][0], seg[1][0]);
      const maxX = Math.max(seg[0][0], seg[1][0]);
      const minY = Math.min(seg[0][1], seg[1][1]);
      const maxY = Math.max(seg[0][1], seg[1][1]);
      for (let gx = Math.floor(minX / this.cell); gx <= Math.floor(maxX / this.cell); gx++) {
        for (let gy = Math.floor(minY / this.cell); gy <= Math.floor(maxY / this.cell); gy++) {
          const key = `${gx},${gy}`;
          const list = this.buckets.get(key);
          if (list) list.push(seg);
          else this.buckets.set(key, [seg]);
        }
      }
    }
  }

  /** 以 `point` 為中心、半徑 `radius` 的方框內所有候選線段。 */
  near(point: Local, radius: number): Segment[] {
    const out: Segment[] = [];
    const lo = [Math.floor((point[0] - radius) / this.cell), Math.floor((point[1] - radius) / this.cell)];
    const hi = [Math.floor((point[0] + radius) / this.cell), Math.floor((point[1] + radius) / this.cell)];
    for (let gx = lo[0]; gx <= hi[0]; gx++) {
      for (let gy = lo[1]; gy <= hi[1]; gy++) {
        const list = this.buckets.get(`${gx},${gy}`);
        if (list) out.push(...list);
      }
    }
    return out;
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 點到線段的最短距離（公尺）。 */
function distanceToSegment(point: Local, [a, b]: Segment): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / len2));
  return Math.hypot(point[0] - a[0] - dx * t, point[1] - a[1] - dy * t);
}

/**
 * 結構外緣的線段集合。
 * 粗虛線在 PDF 中是一串封閉四邊形，取其長軸中線代表該劃，否則取相鄰頂點。
 */
function outlineSegments(sheets: SheetGeometry[]): Segment[] {
  const segments: Segment[] = [];
  for (const sheet of sheets) {
    for (const path of sheet.paths) {
      if (path.category !== "structure") continue;
      const points = path.closed ? path.points.slice(0, -1) : path.points;
      if (points.length < 2) continue;
      if (path.closed && points.length <= 4) {
        const axis = polygonAxis(points);
        if (axis.length < DASH.length && axis.width < DASH.width) {
          segments.push([axis.west, axis.east]);
          continue;
        }
      }
      for (let i = 1; i < points.length; i++) segments.push([points[i - 1], points[i]]);
    }
  }
  return dedupeSegments(segments);
}

/** 依路線代號收集某一類別的線段。 */
function segmentsByLine(sheets: SheetGeometry[], category: "track" | "limit"): Map<DortsLineCode, Segment[]> {
  const byLine = new Map<DortsLineCode, Segment[]>();
  for (const sheet of sheets) {
    for (const path of sheet.paths) {
      if (path.category !== category) continue;
      const list = byLine.get(sheet.index.lineCode) ?? [];
      for (let i = 1; i < path.points.length; i++) list.push([path.points[i - 1], path.points[i]]);
      byLine.set(sheet.index.lineCode, list);
    }
  }
  return byLine;
}

/** 單一取樣點：中心、法線與左右兩側到結構外緣的距離（公尺）。 */
export interface Measured {
  point: Local;
  normal: Local;
  left: number;
  right: number;
}

/** 沿中心線逐點量出左右兩側到結構外緣的距離；兩側皆落空的取樣捨棄。 */
function measureWidths(line: Local[], outline: SegmentIndex): Measured[] {
  const samples = resample(line, SAMPLE_STEP);
  const kept: { point: Local; normal: Local; left: number | null; right: number | null }[] = [];
  for (let i = 0; i < samples.length; i++) {
    const prev = samples[Math.max(0, i - 1)];
    const next = samples[Math.min(samples.length - 1, i + 1)];
    const tx = next[0] - prev[0];
    const ty = next[1] - prev[1];
    const len = Math.hypot(tx, ty);
    if (len < 1e-9) continue;
    const normal: Local = [-ty / len, tx / len];
    const candidates = outline.near(samples[i], RAY_LIMIT);
    const left = rayHit(samples[i], normal, candidates, RAY_LIMIT);
    const right = rayHit(samples[i], [-normal[0], -normal[1]], candidates, RAY_LIMIT);
    if (left === null && right === null) continue;
    kept.push({ point: samples[i], normal, left, right });
  }
  if (kept.length === 0) return [];

  const left = medianFilter(kept.map((k) => k.left), WIDTH_WINDOW);
  const right = medianFilter(kept.map((k) => k.right), WIDTH_WINDOW);
  return kept.map((k, i) => ({ point: k.point, normal: k.normal, left: left[i], right: right[i] }));
}

/** 依淨寬把取樣切成潛盾段與箱形段；過短的段併入相鄰段。 */
export function splitRuns(measured: Measured[]): { bore: boolean; items: Measured[] }[] {
  const runs: { bore: boolean; items: Measured[] }[] = [];
  for (const item of measured) {
    const bore = item.left + item.right <= BORE_MAX_WIDTH;
    const last = runs[runs.length - 1];
    if (last && last.bore === bore) last.items.push(item);
    else runs.push({ bore, items: [item] });
  }

  const runLength = (run: { items: Measured[] }): number => {
    let sum = 0;
    for (let i = 1; i < run.items.length; i++) {
      sum += Math.hypot(
        run.items[i].point[0] - run.items[i - 1].point[0],
        run.items[i].point[1] - run.items[i - 1].point[1],
      );
    }
    return sum;
  };

  for (let i = 0; i < runs.length; ) {
    if (runs.length === 1 || runLength(runs[i]) >= MIN_RUN_LENGTH) {
      i++;
      continue;
    }
    const target = i === 0 ? 1 : i - 1;
    runs[target].items = target < i ? [...runs[target].items, ...runs[i].items] : [...runs[i].items, ...runs[target].items];
    runs.splice(i, 1);
    // 合併後相鄰兩段可能同類，重新自頭檢查
    for (let j = 1; j < runs.length; ) {
      if (runs[j].bore === runs[j - 1].bore) {
        runs[j - 1].items.push(...runs[j].items);
        runs.splice(j, 1);
      } else j++;
    }
    i = 0;
  }
  return runs;
}

/**
 * 箱形段的輪廓：左側偏移點正向排列、右側偏移點反向排列。
 * 射線穿過粗虛線的間隙時會打到遠處的另一座結構，量到的偏移遠大於實際外牆；
 * 故先以該段的中位數夾限，避免輪廓長出尖刺或自交。
 */
function boxPolygon(items: Measured[]): Local[] {
  const clamp = (values: number[]): number[] => {
    const mid = median(values);
    return values.map((v) => Math.min(v, mid * OFFSET_CLAMP));
  };
  const left = clamp(items.map((m) => m.left));
  const right = clamp(items.map((m) => m.right));
  return [
    ...items.map((m, i): Local => [m.point[0] + m.normal[0] * left[i], m.point[1] + m.normal[1] * left[i]]),
    ...items
      .map((m, i): Local => [m.point[0] - m.normal[0] * right[i], m.point[1] - m.normal[1] * right[i]])
      .reverse(),
  ];
}

/** 同一座車站箱涵內的兩條軌道會各自量到相同外牆，取樣中心落在另一段內者捨棄。 */
function dropNestedBoxes(tunnels: TunnelShape[], centres: Map<number, Local[]>): TunnelShape[] {
  const boxes = tunnels.flatMap((t, index) =>
    t.kind === "box" ? [{ index, polygon: t.polygon, area: Math.abs(polygonArea(t.polygon)) }] : [],
  );
  const drop = new Set<number>();
  for (const a of boxes) {
    const points = centres.get(a.index) ?? [];
    if (points.length === 0) continue;
    for (const b of boxes) {
      if (a.index === b.index || drop.has(b.index) || a.area >= b.area) continue;
      const inside = points.filter((p) => pointInPolygon(p, b.polygon)).length;
      if (inside / points.length >= BOX_OVERLAP) {
        drop.add(a.index);
        break;
      }
    }
  }
  return tunnels.filter((_, index) => !drop.has(index));
}

export function buildStructures(sheets: SheetGeometry[]): BuiltStructures {
  const outline = outlineSegments(sheets);
  const index = new SegmentIndex(outline);

  const tracks: LineGeometry[] = [];
  const tunnels: TunnelShape[] = [];
  /** 箱形段的取樣中心，供重複箱涵判定。 */
  const boxCentres = new Map<number, Local[]>();
  for (const [lineCode, segments] of segmentsByLine(sheets, "track")) {
    // 軌道為點劃線，間隔較大；渡線附近並行兩軌相距僅數公尺，跨越間隙時不得側向橫跳
    const lines = chainSegments(dedupeSegments(segments), {
      gap: 12,
      angleToleranceDeg: 15,
      minLength: 20,
      maxLateral: 1.0,
    });
    for (const line of lines) {
      tracks.push({ lineCode, line });
      for (const run of splitRuns(measureWidths(line, index))) {
        if (run.items.length < 2) continue;
        const widths = run.items.map((m) => m.left + m.right);
        if (run.bore) {
          const radius = Math.min(BORE_RADIUS.max, Math.max(BORE_RADIUS.min, median(widths) / 2));
          tunnels.push({ lineCode, kind: "bore", line: run.items.map((m) => m.point), radius });
        } else {
          boxCentres.set(tunnels.length, run.items.map((m) => m.point));
          tunnels.push({ lineCode, kind: "box", polygon: boxPolygon(run.items), width: median(widths) });
        }
      }
    }
  }

  const restrictionLines: LineGeometry[] = [];
  const restrictionOffsets: number[] = [];
  for (const [lineCode, segments] of segmentsByLine(sheets, "limit")) {
    const lines = chainSegments(dedupeSegments(segments), {
      gap: 4,
      angleToleranceDeg: 35,
      minLength: 20,
    });
    for (const line of lines) {
      restrictionLines.push({ lineCode, line });
      for (const point of line) {
        const candidates = index.near(point, 80);
        if (candidates.length === 0) continue;
        let best = Infinity;
        for (const seg of candidates) best = Math.min(best, distanceToSegment(point, seg));
        if (Number.isFinite(best)) restrictionOffsets.push(best);
      }
    }
  }

  return {
    tunnels: dropNestedBoxes(tunnels, boxCentres),
    tracks,
    restrictionLines,
    restrictionOffsets,
  };
}
