/**
 * 出地面階梯與電扶梯的出入口雨棚。
 *
 * 造型依捷運台北車站 M4 出口示意：兩側與後端矮牆、四角立柱、斜邊收頭的頂棚，
 * 正面（階梯頂端那側）開口。各出口一律套用同一造型，實際尺寸未逐一調查。
 * 落在建物內的出入口不產生雨棚：那是進入建物的出入口，不在人行道上。
 */
import { pointInPolygon } from "../../geo/measure.ts";
import { insetRing, polylineLength, slicePolyline } from "../../geo/offset.ts";
import type { Local } from "../../geo/project.ts";
import type { Feature } from "../schema.ts";

/** 雨棚沿階梯方向最多覆蓋的長度（公尺）。 */
const SHED_LENGTH = 10;
/** 覆蓋段的弦長不足此值即不設雨棚（公尺）。 */
const MIN_RUN = 2;
/** 階梯邊緣到矮牆內面的淨距（公尺）。 */
const SHED_CLEARANCE = 0.5;
const WALL_THICKNESS = 0.3;
/** 花崗岩矮牆高度（公尺）。 */
const WALL_HEIGHT = 1.1;
/** 方形立柱邊長（公尺）。 */
const PIER_SIZE = 0.8;
/** 頂棚底面高程與厚度（公尺）：厚度含空間桁架與簷板。 */
const ROOF_SOFFIT = 3.6;
const ROOF_THICKNESS = 0.8;
/** 頂棚底面較矮牆與正面外伸的長度（公尺）。 */
const ROOF_OVERHANG = 1.0;
/** 頂面較底面內縮的長度（公尺）：形成斜簷。 */
const ROOF_INSET = 0.8;
/** 達此高度的建物才算「出入口開在建物內」（公尺）。 */
const ENTRANCE_MIN_HEIGHT = 2.0;

const NOTE =
  "出入口雨棚依捷運台北車站 M4 出口的現場照片（Wikimedia Commons，Solomon203，2019 年）示意：" +
  "兩側與後端為 1.1 公尺高的矮牆，四角立柱撐起底面 3.6 公尺、斜邊收頭的頂棚；" +
  "尺寸為推估，各出口一律套用同一造型。";

/** 出地面的階梯與電扶梯；折線由低端排到高端，末端頂點即地面端。 */
function groundExits(features: Feature[]): Feature[] {
  return features.filter(
    (f) =>
      (f.kind === "stairs" || f.kind === "escalator") &&
      f.baseEnd === 0 &&
      (f.geometry.polyline?.length ?? 0) >= 2,
  );
}

/** 開在建物內的出入口不設雨棚；薄薄一片的屋頂板、雨棚不算建物。 */
function enclosingBuildings(features: Feature[]): Local[][] {
  return features.flatMap((f) => {
    const polygon = f.geometry.polygon;
    if (f.kind !== "building" && f.kind !== "landmark") return [];
    if (!polygon || (f.base ?? 0) > 0.5 || (f.height ?? 0) < ENTRANCE_MIN_HEIGHT) return [];
    return [polygon];
  });
}

/**
 * 各出地面動線的雨棚量體，與其頂棚所佔的平面。
 * 頂棚平面供呼叫端剔除被雨棚取代的 OSM 雨棚面。
 */
export function buildExitSheds(features: Feature[]): { sheds: Feature[]; claims: Local[][] } {
  const buildings = enclosingBuildings(features);
  const sheds: Feature[] = [];
  const claims: Local[][] = [];

  for (const exit of groundExits(features)) {
    const line = exit.geometry.polyline as Local[];
    const top = line[line.length - 1];
    if (buildings.some((polygon) => pointInPolygon(top, polygon))) continue;

    const total = polylineLength(line);
    const run = slicePolyline(line, total - Math.min(SHED_LENGTH, total), total);
    const tail = run[0];
    const dx = tail[0] - top[0];
    const dy = tail[1] - top[1];
    const length = Math.hypot(dx, dy);
    if (length < MIN_RUN) continue;

    // f 指向下階方向（雨棚內部），n 為其左側法線
    const f: Local = [dx / length, dy / length];
    const n: Local = [-f[1], f[0]];
    const at = (s: number, t: number): Local => [
      top[0] + f[0] * s + n[0] * t,
      top[1] + f[1] * s + n[1] * t,
    ];
    const rect = (s0: number, s1: number, t0: number, t1: number): Local[] => [
      at(s0, t0),
      at(s1, t0),
      at(s1, t1),
      at(s0, t1),
    ];

    const hw = (exit.width ?? 3) / 2 + SHED_CLEARANCE;
    const wo = hw + WALL_THICKNESS;
    /** 立柱中心線距中軸的距離（公尺）：柱心落在牆厚中央。 */
    const tc = hw + WALL_THICKNESS / 2;
    const back = length + WALL_THICKNESS;

    const parts: { part: string; geometry: Feature["geometry"]; base: number; height: number }[] = [
      {
        part: "wall-left",
        geometry: { polygon: rect(PIER_SIZE, back - PIER_SIZE, hw, wo) },
        base: 0,
        height: WALL_HEIGHT,
      },
      {
        part: "wall-right",
        geometry: { polygon: rect(PIER_SIZE, back - PIER_SIZE, -wo, -hw) },
        base: 0,
        height: WALL_HEIGHT,
      },
      {
        part: "wall-back",
        geometry: { polygon: rect(length, back, -wo, wo) },
        base: 0,
        height: WALL_HEIGHT,
      },
    ];
    let pier = 0;
    for (const s0 of [0, back - PIER_SIZE]) {
      for (const side of [1, -1]) {
        pier += 1;
        parts.push({
          part: `pier-${pier}`,
          geometry: {
            polygon: rect(
              s0,
              s0 + PIER_SIZE,
              side * tc - PIER_SIZE / 2,
              side * tc + PIER_SIZE / 2,
            ),
          },
          base: 0,
          height: ROOF_SOFFIT,
        });
      }
    }
    const roof = rect(
      -ROOF_OVERHANG,
      back + ROOF_OVERHANG,
      -(wo + ROOF_OVERHANG),
      wo + ROOF_OVERHANG,
    );
    parts.push({
      part: "roof",
      geometry: { polygon: roof, polygonTop: insetRing(roof, ROOF_INSET) },
      base: ROOF_SOFFIT,
      height: ROOF_THICKNESS,
    });
    claims.push(roof);

    const name = exit.name?.startsWith("出口") ? `${exit.name} 雨棚` : "出入口雨棚";
    for (const { part, geometry, base, height } of parts) {
      sheds.push({
        id: `${exit.id}/shed/${part}`,
        kind: "exit-shed",
        name,
        level: "G",
        layer: "passage",
        geometry,
        base,
        height,
        confidence: "estimated",
        sourceNote: NOTE,
        status: "existing",
      });
    }
  }

  return { sheds, claims };
}
