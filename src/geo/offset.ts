import type { Local } from "./project.ts";

/**
 * 折線平行平移。`distance` 為正值時往行進方向左側平移、負值往右側。
 * 轉角以斜接（miter）處理；夾角過小時退回該段法線，避免產生尖刺。
 */
export function offsetPolyline(pts: Local[], distance: number): Local[] {
  if (pts.length < 2) return pts.map(([x, y]) => [x, y] as Local);

  const normals: Local[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dy) || 1;
    normals.push([-dy / len, dx / len]);
  }

  const out: Local[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = normals[Math.max(0, i - 1)];
    const b = normals[Math.min(normals.length - 1, i)];
    let nx = a[0] + b[0];
    let ny = a[1] + b[1];
    const norm = Math.hypot(nx, ny);
    let scale = distance;
    if (norm < 1e-6) {
      nx = b[0];
      ny = b[1];
    } else {
      nx /= norm;
      ny /= norm;
      const cos = nx * b[0] + ny * b[1];
      scale = cos > 0.2 ? distance / cos : distance; // 斜接長度上限約 5 倍
    }
    out.push([pts[i][0] + nx * scale, pts[i][1] + ny * scale]);
  }
  return out;
}

/** 折線總長（公尺）。 */
export function polylineLength(pts: Local[]): number {
  let sum = 0;
  for (let i = 1; i < pts.length; i++) {
    sum += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return sum;
}

/**
 * 自折線起點沿線取指定長度的子折線；長度超過原線時回傳整條。
 * 用於把既有月台中心線截為新建月台的 410 公尺。
 */
export function truncatePolyline(pts: Local[], length: number): Local[] {
  if (pts.length < 2 || length <= 0) return pts.slice(0, 1);
  const out: Local[] = [pts[0]];
  let remain = length;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    const seg = Math.hypot(dx, dy);
    if (seg <= remain) {
      out.push(pts[i]);
      remain -= seg;
      if (remain <= 1e-9) return out;
    } else {
      const t = remain / seg;
      out.push([pts[i - 1][0] + dx * t, pts[i - 1][1] + dy * t]);
      return out;
    }
  }
  return out;
}

/**
 * 以中心線與寬度產生矩形量體的封閉多邊形（左右各半寬）。
 * 回傳順序為左側正向 + 右側反向，形成不自交的環。
 */
export function corridorPolygon(center: Local[], width: number): Local[] {
  const half = width / 2;
  const left = offsetPolyline(center, half);
  const right = offsetPolyline(center, -half);
  return [...left, ...right.slice().reverse()];
}

/**
 * 多邊形環整圈平移：`distance` 為正值往內縮、負值往外長，回傳與輸入同序、同頂點數的環。
 *
 * 以相鄰兩邊的平移線求交點，夾角過小時退回頂點的平均法線，不做自交修復；
 * 位移量須遠小於量體尺寸（地標的退縮層與出挑簷口皆在數十公分至數公尺之譜）。
 * 頂點一一對應是上緣輪廓放樣的前提，因此不得增刪頂點。
 */
export function insetRing(ring: Local[], distance: number): Local[] {
  const n = ring.length;
  if (n < 3) return ring.map(([x, y]) => [x, y] as Local);

  // 逆時針環的內側在各邊左手側；順時針環則相反
  let twice = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    twice += a[0] * b[1] - b[0] * a[1];
  }
  const sign = twice >= 0 ? 1 : -1;

  /** 第 i 條邊（i → i+1）的內法線與方向。 */
  const edges = ring.map((a, i) => {
    const b = ring[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    return { dx: dx / len, dy: dy / len, nx: (-dy / len) * sign, ny: (dx / len) * sign };
  });

  const out: Local[] = [];
  for (let i = 0; i < n; i++) {
    const prev = edges[(i - 1 + n) % n];
    const next = edges[i];
    const p: Local = [
      ring[i][0] + prev.nx * distance,
      ring[i][1] + prev.ny * distance,
    ];
    const q: Local = [ring[i][0] + next.nx * distance, ring[i][1] + next.ny * distance];
    const cross = prev.dx * next.dy - prev.dy * next.dx;
    if (Math.abs(cross) < 1e-6) {
      // 兩邊幾乎共線：法線方向一致，直接取平移後的頂點
      out.push(p);
      continue;
    }
    const t = ((q[0] - p[0]) * next.dy - (q[1] - p[1]) * next.dx) / cross;
    out.push([p[0] + prev.dx * t, p[1] + prev.dy * t]);
  }
  return out;
}

/** 線段與垂直於 x 軸之界線的交點；未穿越回傳 null。 */
function crossingAt(a: Local, b: Local, x: number): Local | null {
  if ((a[0] - x) * (b[0] - x) >= 0 || a[0] === b[0]) return null;
  const t = (x - a[0]) / (b[0] - a[0]);
  return [x, a[1] + (b[1] - a[1]) * t];
}

/** 折線與垂直於 x 軸之界線的第一個交點；未穿越回傳 null。 */
export function polylineCrossingAtX(pts: Local[], x: number): Local | null {
  for (let i = 1; i < pts.length; i++) {
    const cut = crossingAt(pts[i - 1], pts[i], x);
    if (cut) return cut;
  }
  return null;
}

/** 折線第一次穿越 x 界線之處的方位（度，一律取 x 遞增方向）；未穿越回傳 null。 */
export function polylineBearingAtX(pts: Local[], x: number): number | null {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!crossingAt(a, b, x)) continue;
    let deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    if (b[0] < a[0]) deg += 180;
    if (deg > 180) deg -= 360;
    if (deg <= -180) deg += 360;
    return deg;
  }
  return null;
}

/**
 * 以垂直於 x 軸的界線切割折線，回傳界線兩側的折線（含交點）。
 * 多段穿越界線時以第一個交點為準；完全落在同側時另一側回傳空陣列。
 */
export function splitPolylineAtX(pts: Local[], x: number): { west: Local[]; east: Local[] } {
  const west: Local[] = [];
  const east: Local[] = [];
  let crossed = false;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    (p[0] <= x ? west : east).push(p);
    const q = pts[i + 1];
    if (crossed || q === undefined) continue;
    const cut = crossingAt(p, q, x);
    if (!cut) continue;
    west.push(cut);
    east.push(cut);
    crossed = true;
  }
  return { west, east };
}
