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
 * 以折線為界切割多邊形環：左側（侵入側）每一段各自封閉成一塊，
 * 右側則為扣掉這些侵入段後的單一剩餘環（侵入處以進出交點之間的弦封閉）。
 * 環為開放式（首尾不重複），與 OSM 輪廓同一慣例。
 *
 * 前提是界線只由同一側切入、不把多邊形整個橫貫成互不相連的數塊；
 * 本專案的界線為開挖包絡邊緣，與量體平行走過，符合此前提。
 */
export function splitPolygonByPolyline(
  ring: Local[],
  line: Local[],
): { left: Local[][]; right: Local[][] } {
  const n = ring.length;
  const copy = (pts: Local[]): Local[] => pts.map((p) => [...p] as Local);
  if (n < 3 || line.length < 2) return { left: [], right: [copy(ring)] };

  const left = ring.map((p) => sideOfPolyline(line, p) > 0);
  // 全落在同側時不需落刀
  if (left.every((s) => s)) return { left: [copy(ring)], right: [] };
  if (left.every((s) => !s)) return { left: [], right: [copy(ring)] };

  // 自右側頂點起走，剩餘環才會是一條連續的走訪結果
  const start = left.indexOf(false);
  const right: Local[] = [];
  const pieces: Local[][] = [];
  let piece: Local[] = [];
  for (let i = 0; i < n; i++) {
    const a = (start + i) % n;
    const b = (start + i + 1) % n;
    if (left[a]) piece.push(ring[a]);
    else right.push(ring[a]);
    if (left[a] === left[b]) continue;

    const cut = crossing(line, ring[a], ring[b]);
    right.push(cut);
    if (left[a]) {
      piece.push(cut);
      pieces.push(piece);
      piece = [];
    } else {
      piece = [cut];
    }
  }

  return { left: pieces, right: [right] };
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
