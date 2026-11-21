/**
 * 涵蓋範圍：地面與地下各一圈封閉多邊形，決定哪些量體進入場景。
 *
 * 地面量體裁切於地面涵蓋範圍、地下量體裁切於地下涵蓋範圍，因此捷運隧道等
 * 地下結構可以伸出地塊之外。兩圈的頂點以 WGS84 宣告、載入時換算為局部公尺座標，
 * 擷取腳本（`scripts/fetch-osm.ts`）與網站共用同一份定義。
 */
import { clipPolygonToRing, clipPolylineToRing } from "../geo/clip.ts";
import { pointInPolygon, polygonArea, polygonCentroid } from "../geo/measure.ts";
import { toLocal, type Local } from "../geo/project.ts";
import type { Feature } from "./schema.ts";

/** 地塊厚度（公尺）：深於最深的 B4 樓板與潛盾段。 */
export const TERRAIN_DEPTH = 60;

/**
 * 地面涵蓋範圍（逆時針：北緣由東往西、西緣由北往南、南緣由西往東、東緣由南往北）。
 *
 * 北緣為南京東西路、西緣為淡水河與新店溪西岸、南緣為莒光路—南海路—仁愛路、
 * 東緣為建國南北路。各段一律取街道中心線向外偏移 15 至 30 公尺以納入該街道本身；
 * 南海路例外，向內偏移 15 公尺以排除南海路本身。
 */
const OVERGROUND_LONLAT: [number, number][] = [
  [121.5371, 25.05218], // 建國北路 × 南京東路（東偏 30 公尺納入建國高架）
  [121.52248, 25.05243], // 中山北路 × 南京西路
  [121.51436, 25.0545], // 重慶北路 × 南京西路（北移 45 公尺，使建成圓環整圈在界內）
  [121.51176, 25.05405], // 延平北路 × 南京西路
  [121.5075, 25.05389], // 環河北路 × 南京西路
  [121.4958, 25.05389], // 同緯度延伸至淡水河西岸
  [121.4945, 25.0518], // 淡水河西岸水線以西 40 公尺
  [121.4905, 25.0478],
  [121.4775, 25.0463], // 大漢溪河口西岸
  [121.4775, 25.044],
  [121.4825, 25.0415], // 淡水河西岸
  [121.4818, 25.0345], // 新店溪西岸
  [121.483, 25.0312], // 莒光路緯度延伸至西岸（華江派出所以西）
  [121.49688, 25.03095], // 莒光路 × 西園路（南移 15 公尺排除莒光路本身）
  [121.50416, 25.03111], // 莒光路 × 中華路二段
  [121.50709, 25.02663], // 中華路二段 × 南海路
  [121.50891, 25.02943], // 南海路（北移 15 公尺排除南海路本身）
  [121.50928, 25.03041], // 南海路
  [121.51365, 25.03158], // 南海路
  [121.51635, 25.03227], // 南海路
  [121.51811, 25.0328], // 南海路 × 羅斯福路
  [121.51674, 25.0349], // 愛國東路 × 中山南路／羅斯福路（中央銀行在界內）
  [121.518, 25.03945], // 景福門（中山南路 × 仁愛路）
  // 建國南路 × 仁愛路（南移 15 公尺納入仁愛路）。經度取地下範圍東緣（建國南北路）
  // 在此緯度上的位置：兩圈共用這條界線，地面範圍不應凸出於地下範圍之外。
  [121.53793, 25.03793],
];

/** 地面與地下共用的西緣與南緣：自淡水河西岸至南海路 × 羅斯福路。 */
const SHARED_WEST_AND_SOUTH = OVERGROUND_LONLAT.slice(6, 21);

/**
 * 地下涵蓋範圍：北緣推至民生東西路、南緣推至信義路，另含捷運中正紀念堂站。
 *
 * 地面範圍的頂點「愛國東路 × 中山南路」不出現在此圈：中正紀念堂站的凸出段
 * 北緣（25.03560）已在其北側，照抄會使邊界自交。凸出段西端與該頂點同經度，
 * 直接接上景福門後仍完整涵蓋中央銀行一帶，界線不因此內縮。
 */
const UNDERGROUND_LONLAT: [number, number][] = [
  [121.53712, 25.05808], // 建國北路 × 民生東路
  [121.52279, 25.05809], // 中山北路 × 民生西路
  [121.51376, 25.05717], // 重慶北路 × 民生西路
  [121.51158, 25.05712], // 延平北路 × 民生西路
  [121.50829, 25.05705], // 環河北路 × 民生西路
  [121.4995, 25.05705], // 同緯度延伸至淡水河西岸
  [121.4955, 25.0539], // 西岸水線以西，接上共用的西緣
  ...SHARED_WEST_AND_SOUTH,
  [121.5212, 25.0333], // 中正紀念堂站凸出段東南角
  [121.5212, 25.036], // 中正紀念堂站凸出段東北角
  [121.51674, 25.0356], // 凸出段回到中山南路
  [121.518, 25.03945], // 景福門
  [121.52436, 25.03568], // 信義路 × 杭州南路（北移 25 公尺排除東門站與信義路本身）
  [121.5381, 25.03373], // 信義路 × 建國南路（北移 25 公尺）
];

/** 換算為局部公尺座標並斷言逆時針；裁切的內外判定依賴這項約定。 */
function ring(lonlat: [number, number][], name: string): Local[] {
  const points = lonlat.map(([lon, lat]) => toLocal(lon, lat));
  if (polygonArea(points) <= 0) throw new Error(`${name}涵蓋範圍須為逆時針`);
  return points;
}

export const OVERGROUND_RING: Local[] = ring(OVERGROUND_LONLAT, "地面");
export const UNDERGROUND_RING: Local[] = ring(UNDERGROUND_LONLAT, "地下");

/** 封閉成折線，供 `sideOfPolyline` 量測量體到界線的距離。 */
const closed = (r: Local[]): Local[] => [...r, r[0]];

export const OVERGROUND_BOUNDARY: Local[] = closed(OVERGROUND_RING);
export const UNDERGROUND_BOUNDARY: Local[] = closed(UNDERGROUND_RING);

/** 依底面高程選涵蓋範圍：負值取地下、其餘取地面。 */
export function coverageRingFor(base: number): Local[] {
  return base < 0 ? UNDERGROUND_RING : OVERGROUND_RING;
}

/** 點是否落在範圍內（擷取腳本與測試共用）。 */
export function insideRing(point: Local, ring: Local[]): boolean {
  return pointInPolygon(point, ring);
}

function boundsOf(points: Local[]): { min: Local; max: Local } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { min: [minX, minY], max: [maxX, maxY] };
}

const RING_BOUNDS = new WeakMap<Local[], { min: Local; max: Local }>();

/** 外接矩形互不相交時可以直接捨棄，不必逐頂點判側。 */
function outsideBounds(points: Local[], ring: Local[]): boolean {
  let bounds = RING_BOUNDS.get(ring);
  if (bounds === undefined) {
    bounds = boundsOf(ring);
    RING_BOUNDS.set(ring, bounds);
  }
  const box = boundsOf(points);
  return (
    box.max[0] < bounds.min[0] ||
    box.min[0] > bounds.max[0] ||
    box.max[1] < bounds.min[1] ||
    box.min[1] > bounds.max[1]
  );
}

/** 切出的各塊各成一項；只有一塊時沿用原 id。 */
function pieces(feature: Feature, parts: Local[][], key: "polygon" | "polyline"): Feature[] {
  return parts.map((part, n) => ({
    ...feature,
    id: parts.length === 1 ? feature.id : `${feature.id}#${n}`,
    geometry: { ...feature.geometry, [key]: part },
  }));
}

/**
 * 量體裁切至所屬涵蓋範圍；完全落在範圍外時回傳空陣列。
 *
 * 上緣輪廓（`polygonTop`）與兩端高程不同的斜帶量體只做形心判定：
 * 前者的頂點需與 `polygon` 一一對應、後者的兩端高程靠弧長內插，切開都會失真。
 */
export function clipToCoverage(feature: Feature): Feature[] {
  if (feature.kind === "terrain") return [feature];
  const ring = coverageRingFor(feature.base ?? 0);
  const { polygon, polygonTop, polyline, tube } = feature.geometry;

  if (polygon && polygon.length >= 3) {
    if (outsideBounds(polygon, ring)) return [];
    if (polygonTop) return insideRing(polygonCentroid(polygon), ring) ? [feature] : [];
    return pieces(feature, clipPolygonToRing(polygon, ring), "polygon");
  }
  if (polyline && polyline.length >= 2) {
    if (outsideBounds(polyline, ring)) return [];
    if (feature.baseEnd !== undefined) {
      return insideRing(polygonCentroid(polyline), ring) ? [feature] : [];
    }
    return pieces(feature, clipPolylineToRing(polyline, ring), "polyline");
  }
  if (tube && tube.length >= 2) {
    if (outsideBounds(tube, ring)) return [];
    const parts = clipPolylineToRing(tube, ring);
    return parts.map((part, n) => ({
      ...feature,
      id: parts.length === 1 ? feature.id : `${feature.id}#${n}`,
      geometry: { ...feature.geometry, tube: part },
    }));
  }
  return [feature];
}
