/**
 * 廊帶量測：沿軌道中心線等距取樣後向兩側投射法線射線，量出結構外緣的淨寬。
 * 公告圖的結構外緣有一側是粗虛線（一串封閉四邊形），射線會穿過虛線間隙而落空，
 * 因此量到的寬度序列須再以中位數濾波平滑。
 */
import type { Local } from "./project.ts";

/**
 * 沿折線每 `step` 公尺取樣，同時保留原有頂點（兩者依沿線距離合併排序、去重）。
 * 回傳必含起點與終點；輸入少於 2 點或 `step` 非正數時回傳原陣列副本。
 */
export function resample(line: Local[], step: number): Local[] {
  const copy = line.map(([x, y]) => [x, y] as Local);
  if (copy.length < 2 || !(step > 0)) return copy;

  const along: number[] = [0];
  for (let i = 1; i < copy.length; i++) {
    along.push(along[i - 1] + Math.hypot(copy[i][0] - copy[i - 1][0], copy[i][1] - copy[i - 1][1]));
  }
  const total = along[along.length - 1];
  if (total < 1e-9) return [copy[0], copy[copy.length - 1]];

  const marks = [...along];
  for (let d = step; d < total; d += step) marks.push(d);
  marks.sort((a, b) => a - b);

  const out: Local[] = [];
  let seg = 0;
  let last = -Infinity;
  for (const d of marks) {
    if (d - last < 1e-6) continue;
    last = d;
    while (seg < copy.length - 2 && along[seg + 1] < d) seg++;
    const span = along[seg + 1] - along[seg];
    const t = span < 1e-12 ? 0 : (d - along[seg]) / span;
    out.push([
      copy[seg][0] + (copy[seg + 1][0] - copy[seg][0]) * t,
      copy[seg][1] + (copy[seg + 1][1] - copy[seg][1]) * t,
    ]);
  }
  return out;
}

/**
 * 自 `origin` 沿 `direction` 射出，回傳與任一線段最近交點的距離（公尺）。
 * `direction` 不需為單位向量，長度為零或在 `maxDistance` 內無交點時回傳 null。
 */
export function rayHit(
  origin: Local,
  direction: Local,
  segments: [Local, Local][],
  maxDistance: number,
): number | null {
  const len = Math.hypot(direction[0], direction[1]);
  if (len < 1e-12) return null;
  const dx = direction[0] / len;
  const dy = direction[1] / len;

  let best: number | null = null;
  for (const [a, b] of segments) {
    const sx = b[0] - a[0];
    const sy = b[1] - a[1];
    const denom = dx * sy - dy * sx;
    if (Math.abs(denom) < 1e-12) continue;
    const qx = a[0] - origin[0];
    const qy = a[1] - origin[1];
    const t = (qx * sy - qy * sx) / denom;
    const u = (qx * dy - qy * dx) / denom;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    if (t <= 1e-9 || t > maxDistance) continue;
    if (best === null || t < best) best = t;
  }
  return best;
}

/**
 * 奇數視窗的中位數濾波（偶數視窗自動加一）。
 * 視窗內的 null 不列入計算；整個視窗皆為 null 時取序列中最近的有效值填補，
 * 序列全為 null 時回傳全 0 陣列。
 */
export function medianFilter(values: (number | null)[], window: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(0);
  if (n === 0) return out;
  if (!values.some((v) => v !== null && Number.isFinite(v))) return out;

  const size = Math.max(1, Math.floor(window));
  const half = (size % 2 === 0 ? size + 1 : size) >> 1;

  for (let i = 0; i < n; i++) {
    const bucket: number[] = [];
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      const v = values[j];
      if (v !== null && Number.isFinite(v)) bucket.push(v);
    }
    if (bucket.length === 0) {
      // 視窗內全無有效值，往兩側找最近的一個補上
      for (let d = half + 1; d < n; d++) {
        const left = i - d >= 0 ? values[i - d] : null;
        const right = i + d < n ? values[i + d] : null;
        const pick = left !== null && Number.isFinite(left) ? left : right;
        if (pick !== null && Number.isFinite(pick)) {
          bucket.push(pick);
          break;
        }
      }
    }
    if (bucket.length === 0) continue;
    bucket.sort((a, b) => a - b);
    const mid = bucket.length >> 1;
    out[i] = bucket.length % 2 === 1 ? bucket[mid] : (bucket[mid - 1] + bucket[mid]) / 2;
  }
  return out;
}
