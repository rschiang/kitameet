/**
 * 圖幅定位：把公告圖的 PDF 使用者空間座標對到 TWD97 TM2。
 *
 * 比例與方向一律由圖面自身決定——50 公尺 TWD67 方格網給出比例與兩組正交方向，
 * 圖框右上角的指北針在四個候選方向中挑出北向；平移先以圖框中心對齊圖幅索引矩形中心，
 * 再以方格網落在 50 公尺整數倍上的條件做最後校正。
 *
 * 不可改用「圖框四角最小平方套合」：矩形有 180 度旋轉對稱，四角對應有兩組殘差同為零的解，
 * 會使部分圖幅整幅翻轉（已知 SA01RWT004A、SA01RWN007B）。
 */
import proj4 from "proj4";
import type { SheetPaths } from "./pdf.ts";
import { classify } from "./layers.ts";

/** 查詢系統 `proj4_ext.js` 所用的 TWD67 TM2 定義，含七參數。 */
const TWD67 =
  "+proj=tmerc +lat_0=0 +lon_0=121 +k=0.9999 +x_0=250000 +y_0=0 +ellps=aust_SA " +
  "+towgs84=-752,-358,-179,-0.0000011698,0.0000018398,0.0000009822,0.00002329 +units=m +no_defs";
const TWD97 =
  "+proj=tmerc +lat_0=0 +lon_0=121 +k=0.9999 +x_0=250000 +y_0=0 +ellps=GRS80 " +
  "+towgs84=0,0,0,0,0,0,0 +units=m +no_defs";

const toTwd67 = proj4(TWD97, TWD67);

/** 方格網格距（公尺）。 */
const GRID_STEP = 50;

export interface Transform {
  scale: number;
  rotationDeg: number;
  translate: [number, number];
  /** 校正後方格網離 50 公尺整數倍的最大偏差（公尺）。 */
  gridResidual: number;
  /** 方格網校正所移動的距離（公尺）。 */
  snapCorrection: number;
  /** PDF 使用者空間座標轉 TWD97 TM2。 */
  toTwd97(point: [number, number]): [number, number];
}

type Point = [number, number];
type Segment = [Point, Point];

const DEG = Math.PI / 180;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 兩個方向（度）的夾角，值域 0–180。 */
function angleGap(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

/** 把數值對 50 公尺取餘數並折到 ±25 公尺。 */
function foldToGrid(value: number): number {
  const r = ((value % GRID_STEP) + GRID_STEP) % GRID_STEP;
  return r > GRID_STEP / 2 ? r - GRID_STEP : r;
}

// ── 方格網 ──────────────────────────────────────────────

interface GridFit {
  /** 公尺／pt。 */
  scale: number;
  /** 兩組正交方格線的方向（度，無向，0–180）。 */
  directions: [number, number];
  segments: Segment[];
}

/**
 * 以方格線求比例與格網方向：依角度分群取最大的兩群，
 * 各自把端點投影到法線方向，相鄰格線間距的中位數即 50 公尺所佔的點數。
 */
function fitGrid(sheet: SheetPaths): GridFit {
  const candidates: Segment[] = [];
  for (const path of sheet.paths) {
    if (path.layer === null || path.layer.toLowerCase() !== "grid") continue;
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1];
      const b = path.points[i];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 50) candidates.push([a, b]);
    }
  }
  if (candidates.length < 4) throw new Error("方格網線段不足，無法求比例與方向");

  const buckets = new Map<number, Segment[]>();
  for (const seg of candidates) {
    const raw = (Math.atan2(seg[1][1] - seg[0][1], seg[1][0] - seg[0][0]) / DEG + 180) % 180;
    const key = Math.round(raw) % 180;
    const list = buckets.get(key);
    if (list) list.push(seg);
    else buckets.set(key, [seg]);
  }
  const groups = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 2);
  if (groups.length < 2) throw new Error("方格網只有單一方向，無法定位");

  const directions: number[] = [];
  const spacings: number[] = [];
  for (const [, group] of groups) {
    let sumX = 0;
    let sumY = 0;
    for (const seg of group) {
      const length = Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]);
      const raw = (Math.atan2(seg[1][1] - seg[0][1], seg[1][0] - seg[0][0]) / DEG + 180) % 180;
      sumX += Math.cos(2 * raw * DEG) * length;
      sumY += Math.sin(2 * raw * DEG) * length;
    }
    const direction = ((Math.atan2(sumY, sumX) / DEG / 2) + 180) % 180;
    directions.push(direction);

    // 以線段中點投影到法線方向，取相鄰格線的間距；
    // 用中點而非端點，才不會被同群內零點幾度的角度差把投影值拉散。
    const normal: Point = [-Math.sin(direction * DEG), Math.cos(direction * DEG)];
    const offsets = group
      .map((seg) => ((seg[0][0] + seg[1][0]) / 2) * normal[0] + ((seg[0][1] + seg[1][1]) / 2) * normal[1])
      .sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < offsets.length; i++) {
      // 格距至少 50 公尺，小於 50 pt 者必為同一條格線被切成數段
      const gap = offsets[i] - offsets[i - 1];
      if (gap > 50) gaps.push(gap);
    }
    if (gaps.length === 0) continue;
    // 缺格時會量到格距的整數倍，故以最小者為準再取其同值群的中位數
    const smallest = Math.min(...gaps);
    spacings.push(...gaps.filter((g) => g < smallest * 1.1));
  }
  if (spacings.length === 0) throw new Error("方格網間距無法量測");

  return {
    scale: GRID_STEP / median(spacings),
    directions: [directions[0], directions[1]],
    // 只留兩組主方向的格線：圖框內緣與接圖線同在 grid 圖層，會污染後續的 50 公尺校正
    segments: groups.flatMap(([, group]) => group),
  };
}

// ── 指北針 ──────────────────────────────────────────────

interface Ring {
  centre: Point;
  radius: number;
}

/**
 * 圖框右上角的指北針圓：以頂點到形心的距離是否均勻判定。
 * 只在圖框、索引等裝飾圖層上找；地形圖的圓形建物（水塔、油槽）同樣勻稱，
 * 會被誤認為指北針（已知 SA01RWSS05A）。
 */
function findCompass(sheet: SheetPaths): Ring {
  let best: Ring | null = null;
  for (const path of sheet.paths) {
    if (classify(path.layer) !== null) continue;
    const pts = path.points;
    if (pts.length < 10) continue;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    if (w < 15 || w > 90 || h < 15 || h > 90) continue;
    if (Math.abs(w - h) / Math.max(w, h) > 0.12) continue;
    const centre: Point = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    const radii = pts.map((p) => Math.hypot(p[0] - centre[0], p[1] - centre[1]));
    const mean = radii.reduce((s, r) => s + r, 0) / radii.length;
    if (mean <= 0) continue;
    const spread = (Math.max(...radii) - Math.min(...radii)) / mean;
    if (spread > 0.08) continue;
    if (best === null || mean > best.radius) best = { centre, radius: mean };
  }
  if (best === null) throw new Error("找不到指北針");
  return best;
}

/**
 * 指針方向（度）：取指北針圓內的填色小三角形頂點，
 * 以主成分軸為指針主軸，再以「垂距最大值較小」的一半判定針尖。
 */
function compassBearing(sheet: SheetPaths, compass: Ring): number {
  const pts: Point[] = [];
  for (const path of sheet.paths) {
    if (classify(path.layer) !== null) continue;
    if (path.paint !== "f" && path.paint !== "f*" && path.paint !== "b" && path.paint !== "B") continue;
    if (path.points.length > 5) continue;
    for (const p of path.points) {
      if (Math.hypot(p[0] - compass.centre[0], p[1] - compass.centre[1]) <= compass.radius * 1.25) {
        pts.push(p);
      }
    }
  }
  if (pts.length < 3) throw new Error("指北針的指針無法辨識");

  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - cx) ** 2;
    syy += (y - cy) ** 2;
    sxy += (x - cx) * (y - cy);
  }
  const axis = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const along: Point = [Math.cos(axis), Math.sin(axis)];
  const across: Point = [-along[1], along[0]];

  let front = 0;
  let back = 0;
  for (const [x, y] of pts) {
    const t = (x - cx) * along[0] + (y - cy) * along[1];
    const u = Math.abs((x - cx) * across[0] + (y - cy) * across[1]);
    if (t >= 0) front = Math.max(front, u);
    else back = Math.max(back, u);
  }
  const bearing = axis / DEG;
  return front <= back ? bearing : bearing + 180;
}

// ── 定位 ────────────────────────────────────────────────

/** 圖面北向：四個格網候選方向中，與指針方向夾角最小者。 */
function northDirection(grid: GridFit, needle: number): number {
  const candidates = grid.directions.flatMap((d) => [d, d + 180]);
  let best = candidates[0];
  let bestGap = Infinity;
  for (const candidate of candidates) {
    const gap = angleGap(candidate, needle);
    if (gap < bestGap) {
      bestGap = gap;
      best = candidate;
    }
  }
  if (bestGap > 20) throw new Error(`指北針與方格網方向不一致（相差 ${bestGap.toFixed(1)} 度）`);
  return best;
}

/** 殘差取循環中位數。 */
function gridOffset(values: number[]): number {
  return median(values.map(foldToGrid));
}

/**
 * 求某一幅的定位參數。`ring` 為圖幅索引給的圖框四角（TWD97 TM2）。
 */
export function fitSheet(sheet: SheetPaths, ring: [number, number][]): Transform {
  const grid = fitGrid(sheet);
  const compass = findCompass(sheet);
  const needle = compassBearing(sheet, compass);
  const north = northDirection(grid, needle);
  // 圖面北向對應 TWD97 的 +N（90 度）
  const rotationDeg = ((90 - north + 540) % 360) - 180;

  const cos = Math.cos(rotationDeg * DEG) * grid.scale;
  const sin = Math.sin(rotationDeg * DEG) * grid.scale;
  const rotate = (p: Point): Point => [p[0] * cos - p[1] * sin, p[0] * sin + p[1] * cos];

  const frameCentre: Point = [
    sheet.frame.reduce((s, p) => s + p[0], 0) / sheet.frame.length,
    sheet.frame.reduce((s, p) => s + p[1], 0) / sheet.frame.length,
  ];
  const ringCentre: Point = [
    ring.reduce((s, p) => s + p[0], 0) / ring.length,
    ring.reduce((s, p) => s + p[1], 0) / ring.length,
  ];
  const spun = rotate(frameCentre);
  let translate: Point = [ringCentre[0] - spun[0], ringCentre[1] - spun[1]];

  const project = (p: Point): Point => {
    const r = rotate(p);
    return [r[0] + translate[0], r[1] + translate[1]];
  };

  // 方格網校正：格線在 TWD67 應落在 50 公尺整數倍上
  const eastings: number[] = [];
  const northings: number[] = [];
  for (const seg of grid.segments) {
    const a = toTwd67.forward(project(seg[0])) as Point;
    const b = toTwd67.forward(project(seg[1])) as Point;
    const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (Math.abs(b[0] - a[0]) < Math.abs(b[1] - a[1])) eastings.push(mid[0]);
    else northings.push(mid[1]);
  }
  if (eastings.length === 0 || northings.length === 0) {
    throw new Error("方格網缺少其中一個方向，無法校正");
  }
  const shift: Point = [gridOffset(eastings), gridOffset(northings)];
  translate = [translate[0] - shift[0], translate[1] - shift[1]];

  let residual = 0;
  for (const seg of grid.segments) {
    const a = toTwd67.forward(project(seg[0])) as Point;
    const b = toTwd67.forward(project(seg[1])) as Point;
    const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const value = Math.abs(b[0] - a[0]) < Math.abs(b[1] - a[1]) ? mid[0] : mid[1];
    residual = Math.max(residual, Math.abs(foldToGrid(value)));
  }

  return {
    scale: grid.scale,
    rotationDeg,
    translate,
    gridResidual: residual,
    snapCorrection: Math.hypot(shift[0], shift[1]),
    toTwd97: project,
  };
}
