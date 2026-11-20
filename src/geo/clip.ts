/**
 * 以折線為界切割量體：新建工程的開挖包絡邊緣與街道同向（方位約 −11 度），
 * 不是垂直於 x 軸的直線，因此不能以 {@link splitPolylineAtX} 落刀。
 */
import type { Local } from "./project.ts";

/** 點相對於折線的側別：取最近線段，折線行進方向的左側為正，回傳帶號距離（公尺）。 */
export function sideOfPolyline(line: Local[], p: Local): number {
  let best = Infinity;
  let signed = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) continue;
    const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    const distance = Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
    if (distance >= best) continue;
    best = distance;
    signed = dx * (p[1] - a[1]) - dy * (p[0] - a[0]) >= 0 ? distance : -distance;
  }
  return signed;
}

/** 線段跨越折線處的交點，以線段參數二分搜尋 40 次求得（誤差 < 1 mm）。 */
function crossing(line: Local[], a: Local, b: Local): Local {
  const at = (t: number): Local => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const startLeft = sideOfPolyline(line, a) > 0;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (sideOfPolyline(line, at(mid)) > 0 === startLeft) lo = mid;
    else hi = mid;
  }
  return at((lo + hi) / 2);
}

/**
 * 以折線為界切割多邊形環，回傳左右兩側的環（各可能多塊）。
 * 每塊以進出交點封閉；環為開放式（首尾不重複），與 OSM 輪廓同一慣例。
 */
export function splitPolygonByPolyline(
  ring: Local[],
  line: Local[],
): { left: Local[][]; right: Local[][] } {
  const n = ring.length;
  if (n < 3 || line.length < 2) return { left: [], right: [ring.map((p) => [...p] as Local)] };

  const left = ring.map((p) => sideOfPolyline(line, p) > 0);
  // 全落在同側時不需落刀
  if (left.every((s) => s)) return { left: [ring.map((p) => [...p] as Local)], right: [] };
  if (left.every((s) => !s)) return { left: [], right: [ring.map((p) => [...p] as Local)] };

  // 自「前一點在另一側」的頂點起走，使第一塊恰由交點起算
  let start = 0;
  for (let i = 0; i < n; i++) {
    if (left[i] !== left[(i + n - 1) % n]) {
      start = i;
      break;
    }
  }

  const firstCut = crossing(line, ring[(start + n - 1) % n], ring[start]);
  const pieces: { left: boolean; ring: Local[] }[] = [];
  let piece: Local[] = [firstCut];
  let pieceLeft = left[start];
  for (let i = 0; i < n; i++) {
    const a = (start + i) % n;
    const b = (start + i + 1) % n;
    piece.push(ring[a]);
    if (left[a] === left[b]) continue;
    // 繞回起點的那一段共用同一個交點，避免兩次二分搜尋的微小落差
    const cut = i === n - 1 ? firstCut : crossing(line, ring[a], ring[b]);
    piece.push(cut);
    pieces.push({ left: pieceLeft, ring: piece });
    piece = [cut];
    pieceLeft = left[b];
  }

  return {
    left: pieces.filter((p) => p.left).map((p) => p.ring),
    right: pieces.filter((p) => !p.left).map((p) => p.ring),
  };
}

/** 以折線為界切割折線，回傳左右兩側的折線段（各可能多段）。 */
export function splitPolylineByPolyline(
  pts: Local[],
  line: Local[],
): { left: Local[][]; right: Local[][] } {
  if (pts.length < 2 || line.length < 2) return { left: [], right: [pts.map((p) => [...p] as Local)] };

  const left = pts.map((p) => sideOfPolyline(line, p) > 0);
  const pieces: { left: boolean; pts: Local[] }[] = [];
  let piece: Local[] = [];
  let pieceLeft = left[0];
  for (let i = 0; i < pts.length; i++) {
    piece.push(pts[i]);
    if (i === pts.length - 1) break;
    if (left[i] === left[i + 1]) continue;
    const cut = crossing(line, pts[i], pts[i + 1]);
    piece.push(cut);
    pieces.push({ left: pieceLeft, pts: piece });
    piece = [cut];
    pieceLeft = left[i + 1];
  }
  pieces.push({ left: pieceLeft, pts: piece });

  return {
    left: pieces.filter((p) => p.left).map((p) => p.pts),
    right: pieces.filter((p) => !p.left).map((p) => p.pts),
  };
}
