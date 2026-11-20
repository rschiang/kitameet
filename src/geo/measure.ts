/**
 * 幾何量測：由既有多邊形取得主軸，作為新建量體的定位基準，
 * 避免把座標硬寫在方案資料裡。
 */
import type { Local } from "./project.ts";

export interface PolygonAxis {
  /** 主軸中點。 */
  center: Local;
  /** 主軸方位，自正東起算的度數，恆落在 (−90, 90]。 */
  bearing: number;
  /** 沿主軸的長度（公尺）。 */
  length: number;
  /** 垂直主軸的寬度（公尺）。 */
  width: number;
  /** 主軸兩端點，east 為方位方向的一端。 */
  east: Local;
  west: Local;
}

/** 以主成分分析求多邊形的主軸方向與範圍。 */
export function polygonAxis(points: Local[]): PolygonAxis {
  const n = points.length;
  let cx = 0;
  let cy = 0;
  for (const [x, y] of points) {
    cx += x / n;
    cy += y / n;
  }

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of points) {
    const dx = x - cx;
    const dy = y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  let angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  if (angle > Math.PI / 2) angle -= Math.PI;
  if (angle <= -Math.PI / 2) angle += Math.PI;

  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  let minAlong = Infinity;
  let maxAlong = -Infinity;
  let minLateral = Infinity;
  let maxLateral = -Infinity;
  for (const [x, y] of points) {
    const dx = x - cx;
    const dy = y - cy;
    const along = dx * ux + dy * uy;
    const lateral = -dx * uy + dy * ux;
    minAlong = Math.min(minAlong, along);
    maxAlong = Math.max(maxAlong, along);
    minLateral = Math.min(minLateral, lateral);
    maxLateral = Math.max(maxLateral, lateral);
  }

  const mid = (minAlong + maxAlong) / 2;
  const center: Local = [cx + ux * mid, cy + uy * mid];
  return {
    center,
    bearing: (angle * 180) / Math.PI,
    length: maxAlong - minAlong,
    width: maxLateral - minLateral,
    east: [cx + ux * maxAlong, cy + uy * maxAlong],
    west: [cx + ux * minAlong, cy + uy * minAlong],
  };
}

/** 把一個點分解為沿基準方向的距離與左側橫向偏移（公尺）。 */
export function decompose(
  origin: Local,
  bearing: number,
  point: Local,
): { along: number; lateral: number } {
  const rad = (bearing * Math.PI) / 180;
  const dx = point[0] - origin[0];
  const dy = point[1] - origin[1];
  return {
    along: dx * Math.cos(rad) + dy * Math.sin(rad),
    lateral: -dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

/** 自某點沿方位前進指定距離後的座標。 */
export function advance(origin: Local, bearing: number, distance: number): Local {
  const rad = (bearing * Math.PI) / 180;
  return [origin[0] + Math.cos(rad) * distance, origin[1] + Math.sin(rad) * distance];
}

/**
 * 兩組點之間距離最短的一對點，供產生連通道。
 * 兩組皆須至少有一點。
 */
export function nearestPair(a: Local[], b: Local[]): { a: Local; b: Local; distance: number } {
  if (a.length === 0 || b.length === 0) throw new Error("nearestPair 需要非空的兩組點");
  let best = { a: a[0], b: b[0], distance: Infinity };
  for (const p of a) {
    for (const q of b) {
      const distance = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (distance < best.distance) best = { a: p, b: q, distance };
    }
  }
  return best;
}
