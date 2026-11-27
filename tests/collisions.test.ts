/**
 * 著色政策的幾何檢查：只有股道與隧道著路線色，其餘量體一律中性色。
 * 著色量體若與中性量體在空間上相交，畫面上就會出現「路線色穿進站體」的錯覺，
 * 因此此處逐一取樣比對，新增的相交一律視為資料或幾何有誤。
 * 本測試只做回報，不影響渲染。
 */
import { describe, expect, it } from "vitest";
import { buildBaseline } from "../src/data/scene.ts";
import { GROUND_EL, type Feature, type FeatureKind } from "../src/data/schema.ts";
import { resample } from "../src/geo/corridor.ts";
import { pointInPolygon } from "../src/geo/measure.ts";
import { corridorPolygon, offsetPolyline } from "../src/geo/offset.ts";
import type { Local } from "../src/geo/project.ts";

/** 著路線色的量體類型。 */
const TINTED_KINDS: Partial<Record<FeatureKind, true>> = {
  "track-tra": true,
  "track-hsr": true,
  "track-metro": true,
  tunnel: true,
};
/**
 * 不列入比對的量體：著色量體彼此相交無妨；
 * 地塊與只畫背面的站體外殼本就包住軌道；禁限建線為地面標線。
 */
const EXCLUDED_KINDS: Partial<Record<FeatureKind, true>> = {
  ...TINTED_KINDS,
  terrain: true,
  "station-box": true,
  restriction: true,
};

/** 取樣間距、格網邊長與垂直重疊的容許值（公尺）。 */
const SAMPLE_STEP = 1;
const SEGMENT_STEP = 2;
const CELL = 25;
const TOLERANCE = 0.05;

interface Sample {
  p: Local;
  lo: number;
  hi: number;
}

interface Prism {
  ring: Local[];
  lo: number;
  hi: number;
}

/** 折線各頂點的沿線弧長比例。 */
function fractions(line: Local[]): number[] {
  const along = [0];
  for (let i = 1; i < line.length; i++) {
    along.push(along[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  }
  const total = along[along.length - 1];
  return total < 1e-9 ? along.map(() => 0) : along.map((d) => d / total);
}

/** 著色量體的取樣點：帶狀量體取中心線與兩側邊線，平面量體取格點。 */
function samplesOf(f: Feature): Sample[] {
  const base = f.base ?? GROUND_EL;
  const height = f.height ?? 0;
  const end = f.baseEnd ?? base;
  const line = f.geometry.polyline ?? f.geometry.tube;
  if (line && line.length >= 2) {
    const tube = f.geometry.tube !== undefined;
    const half = tube ? (f.radius ?? 3) : (f.width ?? 3) / 2;
    const centre = resample(line, SAMPLE_STEP);
    const u = fractions(centre);
    const offset = Math.max(0, half - 0.1);
    const lines = [centre, offsetPolyline(centre, offset), offsetPolyline(centre, -offset)];
    const out: Sample[] = [];
    for (const pts of lines) {
      pts.forEach((p, i) => {
        const z = base + (end - base) * u[i];
        out.push(tube ? { p, lo: z - half, hi: z + half } : { p, lo: z, hi: z + height });
      });
    }
    return out;
  }

  const polygon = f.geometry.polygon;
  if (!polygon || polygon.length < 3) return [];
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  const out: Sample[] = [];
  for (let x = Math.min(...xs) + SAMPLE_STEP / 2; x < Math.max(...xs); x += SAMPLE_STEP) {
    for (let y = Math.min(...ys) + SAMPLE_STEP / 2; y < Math.max(...ys); y += SAMPLE_STEP) {
      const p: Local = [x, y];
      if (pointInPolygon(p, polygon)) out.push({ p, lo: base, hi: base + height });
    }
  }
  return out;
}

/** 中性量體的柱體；傾斜的帶狀量體逐段拆開，否則整條會被當成一個等高的柱體。 */
function prismsOf(f: Feature): Prism[] {
  const base = f.base ?? GROUND_EL;
  const height = f.height ?? 0;
  const polygon = f.geometry.polygon;
  if (polygon && polygon.length >= 3) return [{ ring: polygon, lo: base, hi: base + height }];

  const line = f.geometry.polyline;
  if (!line || line.length < 2) return [];
  const width = f.width ?? 3;
  const end = f.baseEnd ?? base;
  if (end === base) return [{ ring: corridorPolygon(line, width), lo: base, hi: base + height }];

  const pts = resample(line, SEGMENT_STEP);
  const u = fractions(pts);
  const out: Prism[] = [];
  for (let i = 1; i < pts.length; i++) {
    const za = base + (end - base) * u[i - 1];
    const zb = base + (end - base) * u[i];
    out.push({
      ring: corridorPolygon([pts[i - 1], pts[i]], width),
      lo: Math.min(za, zb),
      hi: Math.max(za, zb) + height,
    });
  }
  return out;
}

const cellKey = (x: number, y: number): string => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;

interface Hit {
  tinted: Feature;
  gray: Feature;
  samples: number;
  overlap: number;
}

function findCollisions(features: Feature[]): Map<string, Hit> {
  const tinted = features.filter((f) => TINTED_KINDS[f.kind] === true && f.line !== undefined);
  const gray = features.filter((f) => EXCLUDED_KINDS[f.kind] !== true);

  // 中性量體依外接矩形登錄格網；取樣點只比對自己所在儲存格的候選
  const index = new Map<string, { feature: Feature; prism: Prism }[]>();
  for (const feature of gray) {
    for (const prism of prismsOf(feature)) {
      const xs = prism.ring.map((p) => p[0]);
      const ys = prism.ring.map((p) => p[1]);
      const x0 = Math.floor(Math.min(...xs) / CELL);
      const x1 = Math.floor(Math.max(...xs) / CELL);
      const y0 = Math.floor(Math.min(...ys) / CELL);
      const y1 = Math.floor(Math.max(...ys) / CELL);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const key = `${x},${y}`;
          const list = index.get(key);
          if (list) list.push({ feature, prism });
          else index.set(key, [{ feature, prism }]);
        }
      }
    }
  }

  const hits = new Map<string, Hit>();
  for (const feature of tinted) {
    for (const sample of samplesOf(feature)) {
      for (const { feature: other, prism } of index.get(cellKey(sample.p[0], sample.p[1])) ?? []) {
        const overlap = Math.min(sample.hi, prism.hi) - Math.max(sample.lo, prism.lo);
        if (overlap <= TOLERANCE || !pointInPolygon(sample.p, prism.ring)) continue;
        const key = `${feature.id} × ${other.id}`;
        const hit = hits.get(key);
        if (hit) {
          hit.samples += 1;
          hit.overlap = Math.max(hit.overlap, overlap);
        } else {
          hits.set(key, { tinted: feature, gray: other, samples: 1, overlap });
        }
      }
    }
  }
  return hits;
}

/**
 * 既知相交須附 (a) 施工改動或 (b) 查無證據的說明與出處；
 * 新增者一律視為資料或幾何有誤。
 */
const KNOWN_COLLISIONS: string[] = [];

describe("著色量體的空間相交", () => {
  it(
    "著路線色的股道與隧道只與既知的中性量體相交",
    () => {
      const hits = findCollisions(buildBaseline());
      const known = new Set(KNOWN_COLLISIONS);

      const added = [...hits.entries()]
        .filter(([key]) => !known.has(key))
        .map(
          ([key, hit]) =>
            `${key}（${hit.tinted.kind} × ${hit.gray.kind}，取樣 ${hit.samples} 點，` +
            `最大垂直重疊 ${hit.overlap.toFixed(2)} 公尺）`,
        );
      expect(added, `新增的相交：著色量體不應穿進中性量體\n${added.join("\n")}`).toEqual([]);

      const gone = KNOWN_COLLISIONS.filter((key) => !hits.has(key));
      expect(gone, `相交已消失，請自 KNOWN_COLLISIONS 移除：\n${gone.join("\n")}`).toEqual([]);
    },
    30_000,
  );
});
