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

/** 點到折線的最近點與距離（公尺）；折線不足兩點時回傳距第一點的距離。 */
export function nearestOnPolyline(
  point: Local,
  line: Local[],
): { point: Local; distance: number } {
  if (line.length === 0) throw new Error("nearestOnPolyline 需要非空的折線");
  if (line.length === 1) {
    return { point: line[0], distance: Math.hypot(point[0] - line[0][0], point[1] - line[0][1]) };
  }
  let best = { point: line[0], distance: Infinity };
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const len2 = vx * vx + vy * vy;
    const t =
      len2 === 0
        ? 0
        : Math.min(1, Math.max(0, ((point[0] - a[0]) * vx + (point[1] - a[1]) * vy) / len2));
    const q: Local = [a[0] + vx * t, a[1] + vy * t];
    const distance = Math.hypot(point[0] - q[0], point[1] - q[1]);
    if (distance < best.distance) best = { point: q, distance };
  }
  return best;
}

/** 多邊形的有向面積（平方公尺），逆時針為正。環為開放式，首尾不重複。 */
export function polygonArea(ring: Local[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

/** 多邊形的形心；面積為零時退回頂點平均。 */
export function polygonCentroid(ring: Local[]): Local {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const cross = a[0] * b[1] - b[0] * a[1];
    area += cross;
    cx += (a[0] + b[0]) * cross;
    cy += (a[1] + b[1]) * cross;
  }
  if (Math.abs(area) < 1e-9) {
    return [
      ring.reduce((s, p) => s + p[0], 0) / ring.length,
      ring.reduce((s, p) => s + p[1], 0) / ring.length,
    ];
  }
  return [cx / (3 * area), cy / (3 * area)];
}

/** 點是否落在多邊形內（射線法）。 */
export function pointInPolygon(point: Local, ring: Local[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > point[1] !== yj > point[1]) {
      const x = ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
      if (point[0] <= x) inside = !inside;
    }
  }
  return inside;
}
