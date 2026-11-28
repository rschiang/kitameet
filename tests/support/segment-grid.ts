import type { Local } from "../../src/geo/project.ts";

/** 格網邊長（公尺）。 */
export const GRID_CELL = 25;

export interface SegmentGrid {
  line: Local[];
  /** 各頂點的累積弧長。 */
  arc: number[];
  /** 格網鍵 `${gx},${gy}` 對應的線段起點索引。 */
  cells: Map<string, number[]>;
}

/** 折線各線段依外接矩形登錄到 GRID_CELL 見方的格網，並附各頂點的累積弧長。 */
export function segmentGrid(line: Local[]): SegmentGrid {
  const arc = [0];
  const cells = new Map<string, number[]>();
  for (let s = 0; s + 1 < line.length; s++) {
    const [a, b] = [line[s], line[s + 1]];
    arc.push(arc[s] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    const [gx0, gx1] = [Math.floor(Math.min(a[0], b[0]) / GRID_CELL), Math.floor(Math.max(a[0], b[0]) / GRID_CELL)];
    const [gy0, gy1] = [Math.floor(Math.min(a[1], b[1]) / GRID_CELL), Math.floor(Math.max(a[1], b[1]) / GRID_CELL)];
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const key = `${gx},${gy}`;
        const bucket = cells.get(key);
        if (bucket) bucket.push(s);
        else cells.set(key, [s]);
      }
    }
  }
  return { line, arc, cells };
}

/**
 * 點到折線的最近投影（距離與弧長），只比對點周圍 `reach` 公尺內格網上的線段。
 * 最近距離不超過 `reach` 時與逐段比對的結果相同；超過時回傳 `{ distance: Infinity, arc: 0 }`。
 */
export function nearestWithin(grid: SegmentGrid, point: Local, reach: number): { distance: number; arc: number } {
  const { line, arc, cells } = grid;
  const [px, py] = point;
  let best = { distance: Infinity, arc: 0 };
  let bestSegment = Infinity;
  const [gx0, gx1] = [Math.floor((px - reach) / GRID_CELL), Math.floor((px + reach) / GRID_CELL)];
  const [gy0, gy1] = [Math.floor((py - reach) / GRID_CELL), Math.floor((py + reach) / GRID_CELL)];
  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gy = gy0; gy <= gy1; gy++) {
      for (const s of cells.get(`${gx},${gy}`) ?? []) {
        const [a, b] = [line[s], line[s + 1]];
        const [vx, vy] = [b[0] - a[0], b[1] - a[1]];
        const len = Math.hypot(vx, vy);
        const t = len === 0 ? 0 : Math.min(1, Math.max(0, ((px - a[0]) * vx + (py - a[1]) * vy) / (len * len)));
        const distance = Math.hypot(a[0] + vx * t - px, a[1] + vy * t - py);
        // 同距離取較小的線段，與逐段掃描先到先得一致
        if (distance < best.distance || (distance === best.distance && s < bestSegment)) {
          best = { distance, arc: arc[s] + t * (arc[s + 1] - arc[s]) };
          bestSegment = s;
        }
      }
    }
  }
  return best.distance > reach ? { distance: Infinity, arc: 0 } : best;
}
