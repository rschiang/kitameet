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
