/**
 * 地標細部量體的共用工具：取既有輪廓、建立立面座標系、放樣矩形與產生量體。
 *
 * 平面一律由既有輪廓推算（禁限建公告圖的房屋面優先、其次 OSM 建物面），不新增座標常數：
 * 各座地標以 {@link outline} 指名既有圖徵，或以 {@link outlineNear} 依錨點取回面積最大的建物面。
 */
import { insetRing } from "../../../geo/offset.ts";
import {
  advance,
  minAreaRect,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
} from "../../../geo/measure.ts";
import { toLocal, type Local } from "../../../geo/project.ts";
import surfaceJson from "../../osm/surface.json";
import type { OsmDataset } from "../../osm-types.ts";
import { dortsBuildingPolygons } from "../../dorts.ts";
import { aboveGround, type Feature } from "../../schema.ts";

const surface = surfaceJson as unknown as OsmDataset;

export { insetRing, minAreaRect, polygonCentroid, polygonArea, pointInPolygon };

/** OSM 輪廓；缺漏時立即失敗，避免靜默少掉一座地標。 */
export function outline(id: string): Local[] {
  const feature = surface.features.find((f) => f.id === id);
  if (!feature?.polygon) throw new Error(`找不到 OSM 輪廓 ${id}`);
  return feature.polygon;
}

/**
 * 以座標取既有輪廓：取 OSM 建物面中形心距指定點 `radius` 公尺內、面積最大者；
 * 有包含該點者優先。找不到即擲出例外，避免靜默少掉一座地標。
 */
export function outlineNear(lon: number, lat: number, radius = 80): Local[] {
  const target = toLocal(lon, lat);
  let best: { polygon: Local[]; area: number; contains: boolean } | null = null;
  for (const feature of surface.features) {
    if (feature.kind !== "building") continue;
    const polygon = feature.polygon;
    if (!polygon || polygon.length < 3) continue;
    const centre = polygonCentroid(polygon);
    const contains = pointInPolygon(target, polygon);
    if (!contains && Math.hypot(centre[0] - target[0], centre[1] - target[1]) > radius) continue;
    const area = Math.abs(polygonArea(polygon));
    const better =
      best === null ||
      (contains && !best.contains) ||
      (contains === best.contains && area > best.area);
    if (better) best = { polygon, area, contains };
  }
  if (best === null) throw new Error(`找不到 ${lon}, ${lat} 半徑 ${radius} 公尺內的 OSM 建物輪廓`);
  return best.polygon;
}

/** 以錨點為心的正多邊形，供沒有對應 OSM 面的地標充當平面。 */
export function polygonAt(lon: number, lat: number, radius: number, sides = 20): Local[] {
  const centre = toLocal(lon, lat);
  return Array.from({ length: sides }, (_, i) => {
    const angle = (i / sides) * Math.PI * 2;
    return [centre[0] + Math.cos(angle) * radius, centre[1] + Math.sin(angle) * radius] as Local;
  });
}

/** 落在輪廓內、面積最大的公告圖房屋面；沒有命中時回傳 null。 */
export function dortsFaceIn(ring: Local[]): Local[] | null {
  let best: { polygon: Local[]; area: number } | null = null;
  for (const polygon of dortsBuildingPolygons()) {
    if (!pointInPolygon(polygonCentroid(polygon), ring)) continue;
    const area = Math.abs(polygonArea(polygon));
    if (best === null || area > best.area) best = { polygon, area };
  }
  return best?.polygon ?? null;
}

/** 以某條邊為基準的局部座標系：`along` 沿邊、`lateral` 指向量體外側。 */
export interface Frame {
  origin: Local;
  /** 自正東起算的度數；`lateral` 為此方位的左側。 */
  bearing: number;
}

export function point(frame: Frame, along: number, lateral: number): Local {
  return advance(advance(frame.origin, frame.bearing, along), frame.bearing + 90, lateral);
}

/** 以局部座標給出矩形環（逆時針）。 */
export function rect(
  frame: Frame,
  along: number,
  lateral: number,
  length: number,
  width: number,
): Local[] {
  const a = length / 2;
  const b = width / 2;
  return [
    point(frame, along - a, lateral - b),
    point(frame, along + a, lateral - b),
    point(frame, along + a, lateral + b),
    point(frame, along - a, lateral + b),
  ];
}

/** 把環整體平移後回傳，用於外傾的翹角與燕尾。 */
export function shift(ring: Local[], frame: Frame, along: number, lateral: number): Local[] {
  const origin = point(frame, 0, 0);
  const moved = point(frame, along, lateral);
  const dx = moved[0] - origin[0];
  const dy = moved[1] - origin[1];
  return ring.map(([x, y]) => [x + dx, y + dy] as Local);
}

/** 把方向相近的連續邊併為一段：輪廓常把同一面牆切成數段短邊。 */
export function mergedEdges(ring: Local[], toleranceDeg = 8): { a: Local; b: Local }[] {
  const n = ring.length;
  const direction = (a: Local, b: Local): number => Math.atan2(b[1] - a[1], b[0] - a[0]);
  const runs: { a: Local; b: Local; heading: number }[] = [];
  const tolerance = (toleranceDeg * Math.PI) / 180;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) continue;
    const heading = direction(a, b);
    const last = runs[runs.length - 1];
    const delta =
      last === undefined
        ? Infinity
        : Math.abs(
            Math.atan2(Math.sin(heading - last.heading), Math.cos(heading - last.heading)),
          );
    if (last !== undefined && delta <= tolerance) last.b = b;
    else runs.push({ a, b, heading });
  }
  // 首尾同向時接成一段，避免正面被輪廓的起點切斷
  if (runs.length > 1) {
    const first = runs[0];
    const last = runs[runs.length - 1];
    const delta = Math.abs(
      Math.atan2(Math.sin(first.heading - last.heading), Math.cos(first.heading - last.heading)),
    );
    if (delta <= tolerance) {
      first.a = last.a;
      runs.pop();
    }
  }
  return runs.map(({ a, b }) => ({ a, b }));
}

/**
 * 由輪廓中朝向某處的外牆建立正面座標系：`lateral` 朝向輪廓外。
 * 取法線最正對目標者（同等正對時取較長的一段），不以長度加權，
 * 否則側面的長牆會蓋過較短的正面。
 */
export function faceFrame(
  ring: Local[],
  toward: Local,
  minLength: number,
): { frame: Frame; length: number } {
  // 逆時針環的外側在各邊右手側，順時針則相反
  const outwardSign = polygonArea(ring) >= 0 ? 1 : -1;
  let best: { frame: Frame; length: number; facing: number } | undefined;
  for (const { a, b } of mergedEdges(ring)) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length < minLength) continue;
    const mid: Local = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const nx = (dy / length) * outwardSign;
    const ny = (-dx / length) * outwardSign;
    const tx = toward[0] - mid[0];
    const ty = toward[1] - mid[1];
    const distance = Math.hypot(tx, ty) || 1;
    const facing = (nx * tx + ny * ty) / distance;
    if (facing <= 0) continue;
    // lateral 需朝外：取外法線為左側的行進方向。順時針輪廓的外法線方向相反，
    // 一律自 (nx, ny) 反推行進方向，不可逕取邊的反向。
    const bearing = (Math.atan2(-nx, ny) * 180) / Math.PI;
    const frame: Frame = { origin: mid, bearing };
    const better =
      best === undefined ||
      facing > best.facing + 0.05 ||
      (Math.abs(facing - best.facing) <= 0.05 && length > best.length);
    if (better) best = { frame, length, facing };
  }
  if (best === undefined) throw new Error("找不到朝向目標的正面");
  return { frame: best.frame, length: best.length };
}

/**
 * 自輪廓形心沿方位（自正東起算的度數，逆時針為正）取遠處一點，
 * 供 {@link faceFrame} 指定正面朝向，避免為了定位而新增座標常數。
 */
export function towards(ring: Local[], bearingDeg: number, distance = 2000): Local {
  return advance(polygonCentroid(ring), bearingDeg, distance);
}

export interface PartInput {
  id: string;
  name: string;
  polygon: Local[];
  polygonTop?: Local[];
  /** 底面的離地高度（公尺）。 */
  base: number;
  height: number;
}

export function part(landmark: string, note: string, input: PartInput): Feature {
  const feature: Feature = {
    id: `landmark/${landmark}/${input.id}`,
    kind: "landmark",
    name: input.name,
    level: "G",
    layer: "landmark",
    geometry: input.polygonTop
      ? { polygon: input.polygon, polygonTop: input.polygonTop }
      : { polygon: input.polygon },
    base: aboveGround(input.base),
    height: input.height,
    confidence: "estimated",
    sourceNote: note,
    status: "existing",
  };
  return feature;
}
