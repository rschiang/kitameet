/**
 * 平面圖解析求面：地形圖的建物輪廓在 PDF 中是打散且互相交叉的線段，
 * 不是封閉環，須先求交點切段、量化成節點建圖，再以半邊走訪取出每一塊面。
 * 線段數可達數萬條，求交點一律經格網索引篩選候選。
 */
import type { Local } from "./project.ts";

/** 交點參數的開區間邊界：端點相接不算真交點，避免把 T 字路口的線段切開。 */
const PARAM_EPS = 1e-9;

/** 以格距 `cell` 把線段依其外接矩形登錄到格網，回傳格網鍵對線段索引的對照。 */
function gridIndex(segments: [Local, Local][], cell: number): Map<string, number[]> {
  const index = new Map<string, number[]>();
  for (let i = 0; i < segments.length; i++) {
    const [a, b] = segments[i];
    const x0 = Math.floor(Math.min(a[0], b[0]) / cell);
    const x1 = Math.floor(Math.max(a[0], b[0]) / cell);
    const y0 = Math.floor(Math.min(a[1], b[1]) / cell);
    const y1 = Math.floor(Math.max(a[1], b[1]) / cell);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = `${x},${y}`;
        const bucket = index.get(key);
        if (bucket) bucket.push(i);
        else index.set(key, [i]);
      }
    }
  }
  return index;
}

/** 以兩兩真交點切分線段：交點參數須同時落在兩段的開區間內，平行與共線者不處理。 */
function splitAtIntersections(segments: [Local, Local][]): [Local, Local][] {
  const n = segments.length;
  let total = 0;
  for (const [a, b] of segments) total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  const cell = Math.max(total / Math.max(n, 1), 1e-6);
  const index = gridIndex(segments, cell);

  const params: number[][] = Array.from({ length: n }, () => []);
  const tested = new Set<string>();
  for (const bucket of index.values()) {
    for (let p = 0; p < bucket.length; p++) {
      for (let q = p + 1; q < bucket.length; q++) {
        const i = bucket[p];
        const j = bucket[q];
        const key = i < j ? `${i},${j}` : `${j},${i}`;
        if (tested.has(key)) continue;
        tested.add(key);

        const [a1, a2] = segments[i];
        const [b1, b2] = segments[j];
        const rx = a2[0] - a1[0];
        const ry = a2[1] - a1[1];
        const sx = b2[0] - b1[0];
        const sy = b2[1] - b1[1];
        const denom = rx * sy - ry * sx;
        if (Math.abs(denom) < 1e-12) continue;
        const qx = b1[0] - a1[0];
        const qy = b1[1] - a1[1];
        const t = (qx * sy - qy * sx) / denom;
        const u = (qx * ry - qy * rx) / denom;
        if (t <= PARAM_EPS || t >= 1 - PARAM_EPS) continue;
        if (u <= PARAM_EPS || u >= 1 - PARAM_EPS) continue;
        params[i].push(t);
        params[j].push(u);
      }
    }
  }

  const out: [Local, Local][] = [];
  for (let i = 0; i < n; i++) {
    const [a, b] = segments[i];
    const cuts = params[i].sort((x, y) => x - y);
    let prev = 0;
    const at = (t: number): Local => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    for (const t of cuts) {
      if (t - prev > PARAM_EPS) out.push([at(prev), at(t)]);
      prev = t;
    }
    if (1 - prev > PARAM_EPS) out.push([at(prev), [b[0], b[1]]]);
  }
  return out;
}

/** 環的有向面積，逆時針為正。 */
function signedArea(ring: Local[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/**
 * 自打散的線段集合取出所有封閉面。
 * `snap` 為節點量化格距（公尺），面積落在 `[minArea, maxArea]` 之外者捨棄；
 * 外圍最大面在此走訪方式下有向面積為負，會自然被濾掉。
 */
export function polygonize(
  segments: [Local, Local][],
  options: { snap: number; minArea: number; maxArea: number },
): Local[][] {
  const { snap, minArea, maxArea } = options;
  const source = segments.filter(
    ([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-9,
  );
  if (source.length === 0) return [];

  const pieces = splitAtIntersections(source);

  // 端點量化為節點，代表座標取該節點所有原始座標的平均
  const nodeOf = new Map<string, number>();
  const sumX: number[] = [];
  const sumY: number[] = [];
  const count: number[] = [];
  const nodeId = ([x, y]: Local): number => {
    const key = `${Math.round(x / snap)},${Math.round(y / snap)}`;
    let id = nodeOf.get(key);
    if (id === undefined) {
      id = sumX.length;
      nodeOf.set(key, id);
      sumX.push(0);
      sumY.push(0);
      count.push(0);
    }
    sumX[id] += x;
    sumY[id] += y;
    count[id] += 1;
    return id;
  };

  const edgeOf = new Map<string, number>();
  const edges: [number, number][] = [];
  for (const [a, b] of pieces) {
    const u = nodeId(a);
    const v = nodeId(b);
    if (u === v) continue; // 自環（量化後兩端同點）捨棄
    const key = u < v ? `${u}|${v}` : `${v}|${u}`;
    if (edgeOf.has(key)) continue;
    edgeOf.set(key, edges.length);
    edges.push([u, v]);
  }
  if (edges.length === 0) return [];

  const pos: Local[] = sumX.map((sx, i) => [sx / count[i], sumY[i] / count[i]]);

  // 反覆剝除度數 ≤ 1 的節點（懸垂線）
  const alive = new Array<boolean>(edges.length).fill(true);
  const degree = new Array<number>(pos.length).fill(0);
  for (const [u, v] of edges) {
    degree[u] += 1;
    degree[v] += 1;
  }
  for (;;) {
    let changed = false;
    for (let e = 0; e < edges.length; e++) {
      if (!alive[e]) continue;
      const [u, v] = edges[e];
      if (degree[u] <= 1 || degree[v] <= 1) {
        alive[e] = false;
        degree[u] -= 1;
        degree[v] -= 1;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // 半邊：edge e 的 e*2 為 u→v、e*2+1 為 v→u
  const from = (h: number): number => (h % 2 === 0 ? edges[h >> 1][0] : edges[h >> 1][1]);
  const to = (h: number): number => (h % 2 === 0 ? edges[h >> 1][1] : edges[h >> 1][0]);
  const outgoing: number[][] = Array.from({ length: pos.length }, () => []);
  for (let e = 0; e < edges.length; e++) {
    if (!alive[e]) continue;
    outgoing[edges[e][0]].push(e * 2);
    outgoing[edges[e][1]].push(e * 2 + 1);
  }
  const heading = (h: number): number => {
    const a = pos[from(h)];
    const b = pos[to(h)];
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };

  const twoPi = Math.PI * 2;
  const used = new Array<boolean>(edges.length * 2).fill(false);
  const limit = pos.length * 4;
  const rings: Local[][] = [];
  for (let h0 = 0; h0 < edges.length * 2; h0++) {
    if (!alive[h0 >> 1] || used[h0]) continue;
    const ring: number[] = [];
    let h = h0;
    let steps = 0;
    let closed = false;
    for (;;) {
      if (used[h]) break;
      used[h] = true;
      ring.push(from(h));
      const v = to(h);
      const back = heading(h) + Math.PI;
      let next = -1;
      let bestDelta = Infinity;
      for (const cand of outgoing[v]) {
        let delta = (back - heading(cand)) % twoPi;
        if (delta < 0) delta += twoPi;
        // 來向本身（折返）排在最後，只有死路才會選到
        if (delta <= 1e-12) delta = twoPi;
        if (delta < bestDelta) {
          bestDelta = delta;
          next = cand;
        }
      }
      if (next < 0) break;
      h = next;
      if (h === h0) {
        closed = true;
        break;
      }
      steps += 1;
      if (steps > limit) break;
    }
    if (!closed || ring.length < 3) continue;

    const poly = ring.map((id) => [pos[id][0], pos[id][1]] as Local);
    const area = signedArea(poly);
    if (area <= 0) continue;
    if (area < minArea || area > maxArea) continue;
    rings.push(poly);
  }
  return rings;
}
