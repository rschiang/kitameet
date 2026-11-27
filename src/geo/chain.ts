/**
 * 線段串接：公告圖的道路邊線、軌道中心線與限建線在 PDF 中是打散的獨立線段
 * （點劃線的每一劃各自成段、順序與首尾方向皆不固定），需還原為連續折線。
 * 輸入可達數萬段，端點一律經格網索引查找，不做兩兩比對。
 */
import type { Local } from "./project.ts";
import { polylineLength } from "./offset.ts";

/** 端點索引項目：第 `seg` 條線段的第 `end` 個端點。 */
interface EndRef {
  seg: number;
  end: 0 | 1;
}

/**
 * 候選線段方向與目前末段方向的夾角（度），值域 0–180。
 * 必須有向：折線本身有行進方向，無向比較會讓「原地折返」的線段得到滿分，
 * 點劃線的虛線處便會接出 180 度的折返。
 */
function angleDiffDeg(ax: number, ay: number, bx: number, by: number): number {
  return (Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) * 180) / Math.PI;
}

/** 以格距 `cell` 為單位的格網鍵。 */
function cellKey(x: number, y: number, cell: number): string {
  return `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
}

/**
 * 貪婪串接打散的線段為折線。
 * `gap` 為可接受的端點間距（公尺），`angleToleranceDeg` 為與目前末段的無向方向差上限，
 * 總長小於 `minLength` 的結果一律捨棄。
 * `maxLateral` 為跨越間隙時偏離目前行進方向的側向距離上限（公尺），預設不限；
 * 軌道中心線須設限，否則渡線附近會橫跳到並行的另一軌。
 */
export function chainSegments(
  segments: [Local, Local][],
  options: { gap: number; angleToleranceDeg: number; minLength: number; maxLateral?: number },
): Local[][] {
  const { gap, angleToleranceDeg, minLength, maxLateral = Infinity } = options;
  const segs = segments.filter(
    ([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-9,
  );
  if (segs.length === 0) return [];

  const cell = Math.max(gap, 1);
  const index = new Map<string, EndRef[]>();
  for (let i = 0; i < segs.length; i++) {
    for (const end of [0, 1] as const) {
      const [x, y] = segs[i][end];
      const key = cellKey(x, y, cell);
      const bucket = index.get(key);
      if (bucket) bucket.push({ seg: i, end });
      else index.set(key, [{ seg: i, end }]);
    }
  }

  const used = new Array<boolean>(segs.length).fill(false);

  /** 自折線尾端持續接上最合適的未用線段，直到找不到候選。 */
  const grow = (pts: Local[]): void => {
    for (;;) {
      const tail = pts[pts.length - 1];
      const prev = pts[pts.length - 2];
      const dx = tail[0] - prev[0];
      const dy = tail[1] - prev[1];
      let bestScore = Infinity;
      let best: EndRef | null = null;

      const cx = Math.floor(tail[0] / cell);
      const cy = Math.floor(tail[1] / cell);
      const span = Math.ceil(gap / cell);
      for (let ix = cx - span; ix <= cx + span; ix++) {
        for (let iy = cy - span; iy <= cy + span; iy++) {
          const bucket = index.get(`${ix},${iy}`);
          if (!bucket) continue;
          for (const ref of bucket) {
            if (used[ref.seg]) continue;
            const near = segs[ref.seg][ref.end];
            const dist = Math.hypot(near[0] - tail[0], near[1] - tail[1]);
            if (dist > gap) continue;
            // 跨越間隙時不得往回走，否則會沿原路折返
            const heading = Math.hypot(dx, dy) || 1;
            if ((near[0] - tail[0]) * dx + (near[1] - tail[1]) * dy < -0.1 * dist * heading) continue;
            // 跨越間隙時不得側向橫跳到並行的另一條線
            const lateral = Math.abs((near[0] - tail[0]) * dy - (near[1] - tail[1]) * dx) / heading;
            if (lateral > maxLateral) continue;
            const far = segs[ref.seg][ref.end === 0 ? 1 : 0];
            const diff = angleDiffDeg(dx, dy, far[0] - near[0], far[1] - near[1]);
            if (diff > angleToleranceDeg) continue;
            const score = dist + 0.05 * diff;
            if (score < bestScore) {
              bestScore = score;
              best = ref;
            }
          }
        }
      }

      if (!best) return;
      used[best.seg] = true;
      const near = segs[best.seg][best.end];
      const far = segs[best.seg][best.end === 0 ? 1 : 0];
      if (Math.hypot(near[0] - tail[0], near[1] - tail[1]) > 1e-9) pts.push([near[0], near[1]]);
      pts.push([far[0], far[1]]);
    }
  };

  const lines: Local[][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const pts: Local[] = [
      [segs[i][0][0], segs[i][0][1]],
      [segs[i][1][0], segs[i][1][1]],
    ];
    // 先往尾端成長，再把折線反向往另一端成長一次
    grow(pts);
    pts.reverse();
    grow(pts);
    pts.reverse();

    // 相鄰重複點去除
    const clean: Local[] = [];
    for (const p of pts) {
      const last = clean[clean.length - 1];
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 1e-9) continue;
      clean.push(p);
    }
    if (clean.length < 2) continue;
    if (polylineLength(clean) < minLength) continue;
    lines.push(clean);
  }
  return lines;
}

/**
 * 線段去重：兩端點在 `tolerance` 公尺內相符者視為同一段，(A, B) 與 (B, A) 不分，
 * 保留第一次出現者的原始座標。
 *
 * 相鄰圖幅的重疊區會把同一條線各畫一次，兩者相差數公分；
 * 若只以固定格距取整去重，落在格界兩側的重複段會雙雙留下，
 * 串接時便會在原地折返。因此改以鄰近格網查找實際距離。
 */
export function dedupeSegments(segments: [Local, Local][], tolerance = 0.1): [Local, Local][] {
  const cell = Math.max(tolerance * 2, 0.05);
  const kept: [Local, Local][] = [];
  const index = new Map<string, number[]>();
  const near = (p: Local, q: Local) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tolerance;

  for (const seg of segments) {
    const [a, b] = seg;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-9) continue;
    const mid: Local = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const gx = Math.floor(mid[0] / cell);
    const gy = Math.floor(mid[1] / cell);
    let duplicate = false;
    for (let dx = -1; dx <= 1 && !duplicate; dx++) {
      for (let dy = -1; dy <= 1 && !duplicate; dy++) {
        for (const i of index.get(`${gx + dx},${gy + dy}`) ?? []) {
          const [c, d] = kept[i];
          if ((near(a, c) && near(b, d)) || (near(a, d) && near(b, c))) {
            duplicate = true;
            break;
          }
        }
      }
    }
    if (duplicate) continue;
    const key = `${gx},${gy}`;
    const list = index.get(key);
    if (list) list.push(kept.length);
    else index.set(key, [kept.length]);
    kept.push(seg);
  }
  return kept;
}
