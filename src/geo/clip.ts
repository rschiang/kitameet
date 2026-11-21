/**
 * 以折線為界切割量體：新建工程的開挖包絡邊緣與街道同向（方位約 −11 度），
 * 不是垂直於 x 軸的直線，因此不能以 {@link splitPolylineAtX} 落刀。
 */
import { pointInPolygon, polygonArea } from "./measure.ts";
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

/**
 * 線段 a→b 與環的第一個交點，連同所在的環邊編號與該邊上的參數。
 * 以解析解求交，才能在封口時沿著環補上轉角頂點。
 */
function firstRingCrossing(
  ring: Local[],
  a: Local,
  b: Local,
): { point: Local; edge: number; t: number } | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  let best: { point: Local; edge: number; t: number; s: number } | null = null;
  for (let i = 0; i < ring.length; i++) {
    const c = ring[i];
    const d = ring[(i + 1) % ring.length];
    const sx = d[0] - c[0];
    const sy = d[1] - c[1];
    const denom = rx * sy - ry * sx;
    if (Math.abs(denom) < 1e-12) continue;
    const qx = c[0] - a[0];
    const qy = c[1] - a[1];
    const s = (qx * sy - qy * sx) / denom;
    const t = (qx * ry - qy * rx) / denom;
    if (s < -1e-9 || s > 1 + 1e-9 || t < -1e-9 || t > 1 + 1e-9) continue;
    if (best !== null && s >= best.s) continue;
    best = { point: [a[0] + rx * s, a[1] + ry * s], edge: i, t, s };
  }
  return best === null ? null : { point: best.point, edge: best.edge, t: best.t };
}

/**
 * 多邊形裁切至逆時針封閉環內；回傳界內的各塊（皆為逆時針的開放環）。
 *
 * 內外一律以 {@link pointInPolygon} 判定，不走 {@link sideOfPolyline}：
 * 涵蓋範圍帶有凸出段，其凹角背後有一整片扇形區域的最近線段是同一個頂點，
 * 取最近線段判側會在該處得到相反的答案。
 *
 * 界內的走訪切成數段後沿環縫合：自某段的離境點沿環的行進方向前進，遇到的下一個
 * 入境點即該段的接續處，兩點之間的環頂點一併補入。離境點不可逕自配回同一段的
 * 入境點：多邊形與環交錯數次時，那會使封口繞行幾乎整圈環。
 */
export function clipPolygonToRing(polygon: Local[], ring: Local[]): Local[][] {
  const m = ring.length;
  if (polygon.length < 3 || m < 3) return [];
  // 環為逆時針，縫合時沿環補點的方向才對；多邊形一併正規化為逆時針
  const source =
    polygonArea(polygon) >= 0
      ? polygon.map((p) => [...p] as Local)
      : polygon.map((p) => [...p] as Local).reverse();
  const n = source.length;

  const inside = source.map((p) => pointInPolygon(p, ring));
  if (inside.every((s) => s)) return [source];
  if (inside.every((s) => !s)) return [];

  /** 界內的連續走訪，附其入境與離境處在環上的位置（邊編號加邊上參數）。 */
  const runs: { points: Local[]; entry: number; exit: number }[] = [];
  const start = inside.indexOf(false);
  let points: Local[] = [];
  let entry = -1;
  for (let i = 0; i < n; i++) {
    const a = (start + i) % n;
    const b = (start + i + 1) % n;
    if (inside[a]) points.push(source[a]);
    if (inside[a] === inside[b]) continue;
    const cut = firstRingCrossing(ring, source[a], source[b]);
    if (cut === null) continue;
    if (!inside[a]) {
      points = [cut.point];
      entry = cut.edge + cut.t;
      continue;
    }
    points.push(cut.point);
    if (entry >= 0) runs.push({ points, entry, exit: cut.edge + cut.t });
    points = [];
    entry = -1;
  }
  if (runs.length === 0) return [];

  const used = new Array<boolean>(runs.length).fill(false);
  const out: Local[][] = [];
  for (let s = 0; s < runs.length; s++) {
    if (used[s]) continue;
    const piece: Local[] = [];
    let k = s;
    for (let guard = 0; guard <= runs.length; guard++) {
      used[k] = true;
      piece.push(...runs[k].points);
      // 沿環往前最近的入境點即接續處；入境與離境沿環必然交錯出現
      let next = -1;
      let nearest = Infinity;
      for (let j = 0; j < runs.length; j++) {
        let delta = runs[j].entry - runs[k].exit;
        if (delta < 0) delta += m;
        if (delta < nearest) {
          nearest = delta;
          next = j;
        }
      }
      if (next < 0) break;
      let edge = Math.floor(runs[k].exit);
      const target = Math.floor(runs[next].entry);
      if (!(edge === target && runs[next].entry >= runs[k].exit)) {
        for (let step = 0; step < m; step++) {
          edge = (edge + 1) % m;
          piece.push([...ring[edge]] as Local);
          if (edge === target) break;
        }
      }
      if (next === s || used[next]) break;
      k = next;
    }
    if (piece.length >= 3) out.push(piece);
  }
  return out;
}

/** 折線裁切至逆時針封閉環內；回傳界內的各段。 */
export function clipPolylineToRing(line: Local[], ring: Local[]): Local[][] {
  if (line.length < 2 || ring.length < 3) return [];
  const inside = line.map((p) => pointInPolygon(p, ring));
  if (inside.every((s) => s)) return [line.map((p) => [...p] as Local)];

  const parts: Local[][] = [];
  let part: Local[] = inside[0] ? [[...line[0]] as Local] : [];
  for (let i = 0; i + 1 < line.length; i++) {
    if (inside[i] === inside[i + 1]) {
      if (inside[i + 1]) part.push([...line[i + 1]] as Local);
      continue;
    }
    const cut = firstRingCrossing(ring, line[i], line[i + 1]);
    if (cut === null) continue;
    if (inside[i]) {
      part.push(cut.point);
      parts.push(part);
      part = [];
    } else {
      part = [cut.point, [...line[i + 1]] as Local];
    }
  }
  if (part.length >= 2) parts.push(part);
  return parts.filter((p) => p.length >= 2);
}
