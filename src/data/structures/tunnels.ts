/**
 * 潛盾圓管與箱涵的高程一律跟著軌道走。
 *
 * 公告圖只給出潛盾與箱涵的平面範圍，深度是推得的；若各自取路線的單一軌道面，
 * 正線依各站月台層起伏後，圓管就會浮在軌道上方或埋進軌道下方，無法據以檢查碰撞。
 * 本模組沿落在潛盾範圍內的每條正線產生圓管（軸心高出軌道面 {@link BORE_AXIS_RISE}），
 * 疊式段兩條正線各有一管；箱涵的底板則依箱涵內同路線正線的最低軌道面推算。
 */
import { pointInPolygon } from "../../geo/measure.ts";
import { polylineLength, slicePolyline } from "../../geo/offset.ts";
import type { Local } from "../../geo/project.ts";
import {
  BORE_AXIS_RISE,
  BOX_BASE_DROP,
  BOX_HEIGHT,
  SOURCE,
  STATION_TOP,
  type DortsBore,
} from "../dorts.ts";
import { levelLabelFor } from "../levels.ts";
import type { Feature } from "../schema.ts";

/** 沿軌道的取樣間距（公尺）。 */
const TUBE_STEP = 0.5;
/** 軌道取樣點與潛盾軸線相距此值以內即屬於該潛盾（公尺）。 */
const BORE_REACH = 3.5;
/** 短於此值的圓管捨棄（公尺）。 */
const MIN_TUBE = 2;
/** 投影須落在軸線兩端之內的餘裕（公尺）。 */
const AXIS_MARGIN = 0.01;

type Bounds = [number, number, number, number];

function boundsOf(points: Local[], pad = 0): Bounds {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX - pad, minY - pad, maxX + pad, maxY + pad];
}

const overlaps = (a: Bounds, b: Bounds): boolean => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
const contains = (b: Bounds, [x, y]: Local): boolean => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

/** 點在折線上的投影：距離與弧長。 */
function project(points: Local[], p: Local): { distance: number; arc: number } {
  let best = { distance: Infinity, arc: 0 };
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const [vx, vy] = [b[0] - a[0], b[1] - a[1]];
    const len = Math.hypot(vx, vy);
    const t = len === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (len * len)));
    const distance = Math.hypot(a[0] + vx * t - p[0], a[1] + vy * t - p[1]);
    if (distance < best.distance) best = { distance, arc: walked + t * len };
    walked += len;
  }
  return best;
}

/** 軌道沿線每 {@link TUBE_STEP} 公尺的取樣點（含終點）與弧長。 */
function samples(polyline: Local[]): { point: Local; arc: number }[] {
  const out: { point: Local; arc: number }[] = [];
  let walked = 0;
  let next = 0;
  for (let i = 1; i < polyline.length; i++) {
    const [a, b] = [polyline[i - 1], polyline[i]];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (seg > 0 && next <= walked + seg) {
      const t = (next - walked) / seg;
      out.push({ point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], arc: next });
      next += TUBE_STEP;
    }
    walked += seg;
  }
  const last = polyline[polyline.length - 1];
  if (out.length === 0 || walked - out[out.length - 1].arc > 1e-9) out.push({ point: last, arc: walked });
  return out;
}

/** 軌道在弧長 `s` 處的軌道面高程：兩端高程依弧長線性內插。 */
function railAt(track: Feature, length: number, s: number): number {
  const base = track.base ?? 0;
  const end = track.baseEnd ?? base;
  return length > 0 ? base + ((end - base) * s) / length : base;
}

/** 有路線、有折線的捷運正線。 */
function metroTracks(tracks: Feature[]): (Feature & { line: NonNullable<Feature["line"]> })[] {
  return tracks.filter(
    (f): f is Feature & { line: NonNullable<Feature["line"]> } =>
      f.kind === "track-metro" && f.line !== undefined && (f.geometry.polyline?.length ?? 0) >= 2,
  );
}

/**
 * 沿正線產生潛盾圓管：軌道取樣點落在同路線潛盾軸線 {@link BORE_REACH} 內、且投影在軸線兩端之內者
 * 屬於該潛盾（多條命中取最近者），同一潛盾的連續取樣成為一段圓管。
 * 公告圖把疊式雙管畫成一條時，上下兩條正線各得一管。
 */
export function boreTubes(tracks: Feature[], bores: DortsBore[]): Feature[] {
  const axes = bores.map((bore) => ({
    bore,
    bounds: boundsOf(bore.axis, BORE_REACH),
    length: polylineLength(bore.axis),
  }));
  const tubes: Feature[] = [];
  for (const track of metroTracks(tracks)) {
    const polyline = track.geometry.polyline as Local[];
    const trackBounds = boundsOf(polyline);
    const nearby = axes.filter((a) => a.bore.line === track.line && overlaps(a.bounds, trackBounds));
    if (nearby.length === 0) continue;
    const length = polylineLength(polyline);

    // 逐點歸屬，再把同一潛盾的連續取樣併成一段。目前的潛盾仍涵蓋此點時沿用：
    // 公告圖常有兩條潛盾範圍重合（相鄰圖幅、疊式段），取最近者會來回跳動，切出零碎的短管
    type Run = { bore: DortsBore; from: number; to: number };
    const runs: Run[] = [];
    let current = null as Run | null;
    for (const { point, arc } of samples(polyline)) {
      let owner: DortsBore | null = null;
      let nearest = Infinity;
      for (const axis of nearby) {
        if (!contains(axis.bounds, point)) continue;
        const hit = project(axis.bore.axis, point);
        if (hit.distance > BORE_REACH) continue;
        if (hit.arc <= AXIS_MARGIN || hit.arc >= axis.length - AXIS_MARGIN) continue;
        if (axis.bore === current?.bore) {
          owner = axis.bore;
          break;
        }
        if (hit.distance >= nearest) continue;
        owner = axis.bore;
        nearest = hit.distance;
      }
      if (current && current.bore === owner) {
        current.to = arc;
        continue;
      }
      if (current) runs.push(current);
      current = owner ? { bore: owner, from: arc, to: arc } : null;
    }
    if (current) runs.push(current);

    const kept = runs.filter((run) => run.to - run.from >= MIN_TUBE);
    const perBore = new Map<string, number>();
    for (const run of kept) perBore.set(run.bore.id, (perBore.get(run.bore.id) ?? 0) + 1);
    const seen = new Map<string, number>();
    for (const { bore, from, to } of kept) {
      const n = seen.get(bore.id) ?? 0;
      seen.set(bore.id, n + 1);
      const pairId = `${bore.id}@${track.id}`;
      const base = railAt(track, length, from) + BORE_AXIS_RISE;
      const baseEnd = railAt(track, length, to) + BORE_AXIS_RISE;
      const tube: Feature = {
        id: (perBore.get(bore.id) as number) === 1 ? pairId : `${pairId}#${n}`,
        kind: "tunnel",
        name: `捷運${bore.label}潛盾隧道`,
        level: levelLabelFor(Math.min(base, baseEnd)),
        structure: bore.structure,
        line: bore.line,
        layer: "metro",
        geometry: { tube: slicePolyline(polyline, from, to) },
        base,
        height: bore.radius * 2,
        radius: bore.radius,
        confidence: "estimated",
        sourceNote: `${SOURCE}的潛盾範圍與管徑；軸線沿所在正線，軸心高出軌道面 ${BORE_AXIS_RISE} 公尺，端部止於車站箱涵外牆。`,
        status: "existing",
      };
      if (Math.abs(baseEnd - base) > 1e-6) tube.baseEnd = baseEnd;
      tubes.push(tube);
    }
  }
  return tubes;
}

/** 公告圖箱涵的 id：`dorts/<圖幅代號>/box/<n>`。 */
const DORTS_BOX = /^dorts\/[A-Z]+\/box\//;

/**
 * 公告圖箱涵的底板依箱涵內同路線正線最低的軌道面推算：底板低於軌道面 {@link BOX_BASE_DROP}；
 * 車站箱涵頂版維持 {@link STATION_TOP}，明挖箱涵淨高 {@link BOX_HEIGHT} 再加箱涵內軌道的高差。
 * 箱涵內沒有同路線正線者不變。
 */
export function fitBoxesToTracks(features: Feature[], tracks: Feature[]): Feature[] {
  const lineTracks = metroTracks(tracks).map((track) => {
    const polyline = track.geometry.polyline as Local[];
    return { track, polyline, bounds: boundsOf(polyline), length: polylineLength(polyline) };
  });
  return features.map((feature) => {
    const polygon = feature.geometry.polygon;
    if (!DORTS_BOX.test(feature.id) || !polygon || feature.line === undefined) return feature;
    const bounds = boundsOf(polygon);
    let min = Infinity;
    let max = -Infinity;
    for (const { track, polyline, bounds: trackBounds, length } of lineTracks) {
      if (track.line !== feature.line || !overlaps(bounds, trackBounds)) continue;
      for (const { point, arc } of samples(polyline)) {
        if (!contains(bounds, point) || !pointInPolygon(point, polygon)) continue;
        const rail = railAt(track, length, arc);
        min = Math.min(min, rail);
        max = Math.max(max, rail);
      }
    }
    if (min === Infinity) return feature;
    const base = min - BOX_BASE_DROP;
    return {
      ...feature,
      level: levelLabelFor(base),
      base,
      height: feature.kind === "station-box" ? STATION_TOP - base : max - min + BOX_HEIGHT,
      sourceNote: `${SOURCE}；底板依箱涵內正線最低的軌道面推算。`,
    };
  });
}
