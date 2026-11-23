import type { Local } from "./project.ts";

/**
 * 線形元素。`radius` 為正值代表向左轉（逆時針）、負值向右轉；單位公尺。
 * `angle` 為圓曲線的圓心角，單位為度。`length` 單位為公尺。
 */
export type AlignmentElement =
  | { kind: "straight"; length: number }
  | { kind: "arc"; radius: number; angle: number }
  | { kind: "transition"; radius: number; length: number };

/**
 * 線形：由起點、起始方位與一串元素構成。
 * `bearing` 以正東為 0 度、逆時針為正，與 OSM 量得的月台主軸 −10.7 度同一慣例。
 */
export interface Alignment {
  start: Local;
  bearing: number;
  elements: AlignmentElement[];
}

const DEG = Math.PI / 180;

/** 角度正規化到 (−180, 180] 度。 */
function normalizeAngle(deg: number): number {
  let v = deg % 360;
  if (v > 180) v -= 360;
  if (v <= -180) v += 360;
  return v;
}

/** 緩和曲線建議長度：本專案一律取 0.5 × 半徑。 */
export function transitionLength(radius: number): number {
  return 0.5 * Math.abs(radius);
}

/**
 * 以固定弧長間隔取樣線形，回傳局部公尺座標折線。
 * 緩和曲線以三次拋物線 y = x³/(6RL) 近似，與示意圖的繪法一致。
 */
export function sampleAlignment(a: Alignment, step = 2): Local[] {
  const pts: Local[] = [a.start];
  let x = a.start[0];
  let y = a.start[1];
  let heading = a.bearing * DEG;

  const push = (px: number, py: number) => {
    const last = pts[pts.length - 1];
    if (Math.hypot(px - last[0], py - last[1]) > 1e-9) pts.push([px, py]);
  };

  for (const el of a.elements) {
    if (el.kind === "straight") {
      const n = Math.max(1, Math.ceil(el.length / step));
      for (let i = 1; i <= n; i++) {
        const s = (el.length * i) / n;
        push(x + Math.cos(heading) * s, y + Math.sin(heading) * s);
      }
      x += Math.cos(heading) * el.length;
      y += Math.sin(heading) * el.length;
    } else if (el.kind === "arc") {
      const r = Math.abs(el.radius);
      const sign = Math.sign(el.radius) || 1;
      const total = el.angle * DEG; // 圓心角恆為正值，轉向由 radius 正負決定
      // 圓心位於行進方向左側（左轉）或右側（右轉）
      const cx = x - Math.sin(heading) * r * sign;
      const cy = y + Math.cos(heading) * r * sign;
      const startAngle = Math.atan2(y - cy, x - cx);
      const n = Math.max(1, Math.ceil((r * total) / step));
      for (let i = 1; i <= n; i++) {
        const t = startAngle + sign * total * (i / n);
        push(cx + Math.cos(t) * r, cy + Math.sin(t) * r);
      }
      const end = startAngle + sign * total;
      x = cx + Math.cos(end) * r;
      y = cy + Math.sin(end) * r;
      heading += sign * total;
    } else {
      const r = Math.abs(el.radius);
      const sign = Math.sign(el.radius) || 1;
      const L = el.length;
      const n = Math.max(1, Math.ceil(L / step));
      const cos = Math.cos(heading);
      const sin = Math.sin(heading);
      // 以切線為軸的局部座標 (u, v)，v = u³ / (6RL)
      const localPt = (u: number): [number, number] => {
        const v = (sign * u * u * u) / (6 * r * L);
        return [x + cos * u - sin * v, y + sin * u + cos * v];
      };
      for (let i = 1; i <= n; i++) {
        const [px, py] = localPt((L * i) / n);
        push(px, py);
      }
      const [ex, ey] = localPt(L);
      x = ex;
      y = ey;
      heading += sign * Math.atan(L / (2 * r)); // 三次拋物線末端切線角 atan(L/2R)
    }
  }

  return pts;
}

/** 線形總長（公尺）。 */
export function alignmentLength(a: Alignment): number {
  return a.elements.reduce((sum, el) => {
    if (el.kind === "straight") return sum + el.length;
    if (el.kind === "arc") return sum + Math.abs(el.radius) * el.angle * DEG;
    return sum + el.length;
  }, 0);
}

/** 線形末端的位置與方位（度），供後續線形接續使用。 */
export function alignmentEnd(a: Alignment): { point: Local; bearing: number } {
  const pts = sampleAlignment(a, 1);
  const point = pts[pts.length - 1];
  const prev = pts[pts.length - 2] ?? a.start;
  return {
    point,
    bearing: (Math.atan2(point[1] - prev[1], point[0] - prev[0]) * 180) / Math.PI,
  };
}

/**
 * 相切連接器：自既有線形上的接軌點（位置與方位皆固定）以一組反向曲線接到
 * 目標切線（`target` 點、`targetBearing` 方位），兩端方位皆連續。
 * 兩段曲線同半徑、各配一組長 0.5R 的緩和曲線；半徑自 `radius` 起每 1 公尺往下
 * 試到 `minRadius`，取第一個可行解。無解回傳 null。
 *
 * 第一段曲線一律朝目標點所在的一側轉，反向曲線整組的淨轉角因而可正可負
 * （目標切線與接軌點切線的轉向相反時即是如此）。
 */
export function tangentConnector(
  tie: Local,
  tieBearing: number,
  target: Local,
  targetBearing: number,
  radius: number,
  minRadius: number,
): { points: Local[]; radius: number } | null {
  const turn = normalizeAngle(targetBearing - tieBearing);
  // 第一段曲線的轉向：接軌點切線與「接軌點→目標點」的外積符號，即目標點所在的一側
  const cross =
    Math.cos(tieBearing * DEG) * (target[1] - tie[1]) -
    Math.sin(tieBearing * DEG) * (target[0] - tie[0]);
  const first = Math.sign(cross) || 1;
  // 目標切線的單位切向量與法向量
  const tx = Math.cos(targetBearing * DEG);
  const ty = Math.sin(targetBearing * DEG);
  const nx = -ty;
  const ny = tx;

  const build = (r: number, a1: number): AlignmentElement[] => {
    const length = transitionLength(r);
    // 兩段圓曲線的淨轉角差即為所需轉向量；緩和曲線一正一反自動抵銷
    const a2 = a1 - first * turn;
    return [
      { kind: "transition", radius: first * r, length },
      { kind: "arc", radius: first * r, angle: a1 },
      { kind: "transition", radius: first * r, length },
      { kind: "transition", radius: -first * r, length },
      { kind: "arc", radius: -first * r, angle: a2 },
      { kind: "transition", radius: -first * r, length },
    ];
  };

  const endOf = (r: number, a1: number): Local => {
    const pts = sampleAlignment({ start: tie, bearing: tieBearing, elements: build(r, a1) }, 4);
    return pts[pts.length - 1];
  };
  /** 末點對目標切線的垂距；為零即落在切線上。 */
  const perpOf = (r: number, a1: number): number => {
    const [ex, ey] = endOf(r, a1);
    return (ex - target[0]) * nx + (ey - target[1]) * ny;
  };

  // 第二段圓曲線的角度不得為負，搜尋自 a1 = max(0, first × turn) 起算
  const start = Math.max(0, first * turn);
  for (let r = radius; r >= minRadius; r -= 1) {
    let prevAngle = start;
    let prevPerp = perpOf(r, prevAngle);
    for (let a1 = start + 0.25; a1 <= 150; a1 += 0.25) {
      const perp = perpOf(r, a1);
      if (prevPerp === 0 || prevPerp * perp < 0) {
        let lo = prevAngle;
        let hi = a1;
        for (let i = 0; i < 50; i++) {
          const mid = (lo + hi) / 2;
          if (perpOf(r, mid) * prevPerp > 0) lo = mid;
          else hi = mid;
        }
        const angle = (lo + hi) / 2;
        const end = endOf(r, angle);
        const along = (end[0] - target[0]) * tx + (end[1] - target[1]) * ty;
        const gap = Math.hypot(end[0] - target[0], end[1] - target[1]);
        if (along <= 0.5 && gap <= 420) {
          const pts = sampleAlignment({ start: tie, bearing: tieBearing, elements: build(r, angle) }, 4);
          return { points: [...pts, target], radius: r };
        }
      }
      prevAngle = a1;
      prevPerp = perp;
    }
  }
  return null;
}

/**
 * 轉向連接器：自月台側切線上的起點（`start`、`startBearing`）以單一半徑的主曲線
 * 轉入既有線形上的接軌點（`tie`、`tieBearing`，兩個方位皆為同一行進方向）。
 *
 * 與 {@link tangentConnector} 的曲線順序相反：先朝主曲線的反方向小角度偏轉，
 * 再以主曲線完成整個轉向，主曲線末端沿接軌點切線直線延伸到接軌點。
 * 反向偏角是解出來的結果，使主曲線末點恰落在接軌點切線上；
 * 偏角小於兩段緩和曲線的轉角時，反向段縮短緩和曲線、不設圓曲線。
 * 兩段曲線同半徑、主曲線各配一組長 0.5R 的緩和曲線。無解回傳 null。
 */
export function turnConnector(
  start: Local,
  startBearing: number,
  tie: Local,
  tieBearing: number,
  radius: number,
): { points: Local[]; counter: number } | null {
  /** 反向曲線偏角上限（度）。 */
  const MAX_COUNTER = 60;
  /** 曲線末端到接軌點容許的直線長度（公尺）。 */
  const MAX_STRAIGHT = 500;

  const turn = normalizeAngle(tieBearing - startBearing);
  const main = Math.sign(turn) || 1;
  const sweep = Math.abs(turn);
  const length = transitionLength(radius);
  // 三次拋物線末端切線角，與 sampleAlignment 一致
  const spiral = (Math.atan(length / (2 * radius)) * 180) / Math.PI;
  // 接軌點切線的單位切向量與法向量
  const tx = Math.cos(tieBearing * DEG);
  const ty = Math.sin(tieBearing * DEG);
  const nx = -ty;
  const ny = tx;

  const build = (counter: number): AlignmentElement[] | null => {
    const angle = sweep + counter - 2 * spiral;
    if (angle < 0) return null;
    const elements: AlignmentElement[] = [];
    if (counter > 2 * spiral) {
      elements.push(
        { kind: "transition", radius: -main * radius, length },
        { kind: "arc", radius: -main * radius, angle: counter - 2 * spiral },
        { kind: "transition", radius: -main * radius, length },
      );
    } else if (counter > 0) {
      const short = 2 * radius * Math.tan((counter / 2) * DEG);
      elements.push(
        { kind: "transition", radius: -main * radius, length: short },
        { kind: "transition", radius: -main * radius, length: short },
      );
    }
    elements.push(
      { kind: "transition", radius: main * radius, length },
      { kind: "arc", radius: main * radius, angle },
      { kind: "transition", radius: main * radius, length },
    );
    return elements;
  };

  const sample = (counter: number): Local[] | null => {
    const elements = build(counter);
    return elements && sampleAlignment({ start, bearing: startBearing, elements }, 4);
  };
  /** 末點對接軌點切線的垂距；為零即落在切線上。 */
  const perpOf = (counter: number): number | null => {
    const pts = sample(counter);
    if (!pts) return null;
    const [ex, ey] = pts[pts.length - 1];
    return (ex - tie[0]) * nx + (ey - tie[1]) * ny;
  };

  const first = perpOf(0);
  const last = perpOf(MAX_COUNTER);
  if (first === null || last === null || first * last > 0) return null;

  let lo = 0;
  let hi = MAX_COUNTER;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    const perp = perpOf(mid);
    if (perp === null) return null;
    if (perp * first > 0) lo = mid;
    else hi = mid;
  }
  const counter = (lo + hi) / 2;
  const pts = sample(counter);
  if (!pts) return null;

  const end = pts[pts.length - 1];
  const straight = -((end[0] - tie[0]) * tx + (end[1] - tie[1]) * ty);
  if (straight < -0.5 || straight > MAX_STRAIGHT) return null;
  return { points: [...pts, tie], counter };
}
