/**
 * 涵蓋範圍：地面與地下各一圈封閉多邊形，決定哪些量體進入場景。
 *
 * 地面量體裁切於地面涵蓋範圍、地下量體裁切於地下涵蓋範圍，因此捷運隧道等
 * 地下結構可以伸出地塊之外。兩圈的頂點以 WGS84 宣告、載入時換算為局部公尺座標，
 * 擷取腳本（`scripts/fetch-osm.ts`）與網站共用同一份定義。
 */
import { clipPolygonToRing, splitPolylineByRing } from "../geo/clip.ts";
import { pointInPolygon, polygonArea, polygonCentroid } from "../geo/measure.ts";
import { polylineLength } from "../geo/offset.ts";
import { toLocal, type Local } from "../geo/project.ts";
import { elevationAt } from "./elevation.ts";
import { GROUND_EL, type Feature, type LayerId } from "./schema.ts";

/** 地塊厚度（公尺）：深於最深的 B4 樓板與潛盾段。 */
export const TERRAIN_DEPTH = 60;

/**
 * 兩圈共用的西緣與南緣。西緣自淡水河西岸切口（121.4905）一路正南，不再向西繞出
 * 大漢溪河口與新店溪西岸；南緣沿莒光路、和平西路二段、南海路向東。
 */
const SHARED_WEST_AND_SOUTH: [number, number][] = [
  [121.4905, 25.0478], // 西界切口北端
  [121.4905, 25.031], // 西界 × 莒光路緯度
  [121.49688, 25.03095], // 莒光路 × 西園路（南移 15 公尺納入莒光路）
  [121.50416, 25.03111], // 莒光路 × 中華路二段
  [121.5084, 25.03107], // 莒光路延伸線 × 和平西路二段（虛擬交會點）
  [121.50923, 25.03036], // 和平西路二段 × 南海路（南移 15 公尺）
  [121.51365, 25.03158], // 南海路
  [121.51635, 25.03227], // 南海路
];

/**
 * 兩圈共用的東緣：建國南北路。取路廊（含建國高架）逐緯度的最東頂點再外推約 20 公尺。
 * 信義路口至仁愛路口之間取同一條經線 121.53831，不設轉折點。此經線切在仁愛路口
 * 東側：高架（橋面中心線最東 121.53799）與地面主線完整在界內，OSM 標為
 * `secondary_link`、實際為路口右轉側車道的一段（最東達 121.53906）落在界外。
 */
const SHARED_EAST: [number, number][] = [
  [121.53831, 25.03766], // 仁愛路 × 建國南路（地面範圍的東南角；與信義路口同經度）
  [121.53851, 25.0396],
  [121.53811, 25.04096],
  [121.5376, 25.04231],
  [121.53734, 25.04367], // 自此以北路廊轉直，沿同一經線北上
];

/**
 * 地面涵蓋範圍（逆時針：北緣由東往西、西緣由北往南、南緣由西往東、東緣由南往北）。
 *
 * 北緣為南京東西路、西緣為淡水河西岸、南緣為莒光路—和平西路二段—南海路—仁愛路、
 * 東緣為建國南北路。各段一律取街道中心線向外偏移 15 至 30 公尺以納入該街道本身；
 * 南海路例外，向內偏移 15 公尺以排除南海路本身。
 */
const OVERGROUND_LONLAT: [number, number][] = [
  [121.53734, 25.05218], // 建國北路 × 南京東路
  [121.52248, 25.05243], // 中山北路 × 南京西路
  [121.51436, 25.0545], // 重慶北路 × 南京西路（北移 45 公尺，使建成圓環整圈在界內）
  [121.51176, 25.05405], // 延平北路 × 南京西路
  [121.5075, 25.05389], // 環河北路 × 南京西路
  [121.499, 25.0558], // 忠孝碼頭（淡水河西岸）
  [121.4945, 25.0519], // 淡水河西岸
  ...SHARED_WEST_AND_SOUTH,
  [121.51674, 25.0349], // 愛國東路 × 中山南路
  [121.51775, 25.0383], // 中山南路東側，景福門圓環以南
  [121.51824, 25.03872], // 景福門圓環東南，圓環整圈納入界內
  [121.52176, 25.03846], // 仁愛路一段南側（南移約 25 公尺納入仁愛路）
  [121.52513, 25.03802], // 仁愛路二段南側
  [121.53306, 25.0377], // 仁愛路三段南側
  ...SHARED_EAST,
];

/**
 * 地下涵蓋範圍：北緣推至民生東西路、西緣外推至機場捷運過河隧道末端以西、
 * 南緣推至信義路，另含捷運中正紀念堂站的凸出段。
 *
 * 地面範圍繞過景福門圓環的兩點不出現在此圈：中正紀念堂站凸出段的北緣（25.036）
 * 已在其北側，照抄會使邊界自交。凸出段直接接上信義路 × 杭州南路後仍完整涵蓋
 * 地面範圍，界線不因此內縮。
 */
const UNDERGROUND_LONLAT: [number, number][] = [
  [121.53727, 25.05808], // 建國北路 × 民生東路
  [121.52279, 25.05809], // 中山北路 × 民生西路
  [121.51376, 25.05717], // 重慶北路 × 民生西路
  [121.51158, 25.05712], // 延平北路 × 民生西路
  [121.50829, 25.05705], // 環河北路 × 民生西路
  [121.50248, 25.05843], // 民生西路緯度上的淡水河西岸
  [121.4937, 25.0533], // 機場捷運隧道末端（121.49494, 25.05331）以西 120 公尺
  ...SHARED_WEST_AND_SOUTH,
  [121.5212, 25.0333], // 中正紀念堂站凸出段東南角
  [121.5212, 25.036], // 中正紀念堂站凸出段東北角
  [121.52436, 25.03568], // 信義路 × 杭州南路（北移 25 公尺排除東門站與信義路本身）
  [121.53831, 25.03373], // 信義路 × 建國南路（北移 25 公尺；經度同東緣，界線為一直線）
  ...SHARED_EAST,
  [121.53734, 25.05218], // 建國北路 × 南京東路，自此北上接民生東路
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

/** 以地下涵蓋範圍裁切的圖層；其餘圖層一律取地面範圍。 */
const UNDERGROUND_LAYERS: Partial<Record<LayerId, true>> = {
  "station-box": true,
  platform: true,
  track: true,
  mall: true,
  metro: true,
  passage: true,
  restriction: true,
};

/** 依圖層選涵蓋範圍：軌道系統取地下、街廓與面狀地物取地面。 */
export function coverageRingFor(layer: LayerId): Local[] {
  return UNDERGROUND_LAYERS[layer] ? UNDERGROUND_RING : OVERGROUND_RING;
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
function pieces(feature: Feature, parts: Local[][], key: "polygon" | "polyline" | "tube"): Feature[] {
  return parts.map((part, n) => ({
    ...feature,
    id: parts.length === 1 ? feature.id : `${feature.id}#${n}`,
    geometry: { ...feature.geometry, [key]: part },
  }));
}

/** 裁切產生的頂點落在原折線上的容許誤差（公尺）。 */
const ON_LINE = 1e-6;

/**
 * 各點落在折線上的累積弧長比例。裁切產生的頂點必定落在原折線上，
 * 取所在線段的投影即為精確值；引道不自我交疊，不會配錯線段。
 *
 * `splitPolylineByRing` 切出的每一段依原折線方向排列，頂點為原頂點的複本或線段上的交點，
 * 因此自前一點所在線段向後找第一條距離不超過 {@link ON_LINE} 者即為所在線段，整體為線性時間；
 * 向後找不到時退回全段最近線段。
 */
function fractionsAlong(line: Local[], points: Local[]): number[] {
  const cumulative: number[] = [0];
  for (let i = 1; i < line.length; i++) {
    cumulative.push(
      cumulative[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]),
    );
  }
  const total = cumulative[cumulative.length - 1];
  if (total <= 0) return points.map(() => 0);
  /** 點投影到第 i 條線段：距離與累積弧長。 */
  const project = (i: number, point: Local) => {
    const [ax, ay] = line[i];
    const dx = line[i + 1][0] - ax;
    const dy = line[i + 1][1] - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy) / len2)) : 0;
    return {
      distance: Math.hypot(ax + t * dx - point[0], ay + t * dy - point[1]),
      arc: cumulative[i] + t * Math.sqrt(len2),
    };
  };
  let cursor = 0;
  return points.map((point) => {
    for (let i = cursor; i + 1 < line.length; i++) {
      const { distance, arc } = project(i, point);
      if (distance <= ON_LINE) {
        cursor = i;
        return arc / total;
      }
    }
    let best = 0;
    let nearest = Infinity;
    for (let i = 0; i + 1 < line.length; i++) {
      const { distance, arc } = project(i, point);
      if (distance < nearest) {
        nearest = distance;
        best = arc / total;
        cursor = i;
      }
    }
    return best;
  });
}

/**
 * 量體裁切至所屬涵蓋範圍；完全落在範圍外時回傳空陣列。
 *
 * 上緣輪廓（`polygonTop`）只做形心判定：其頂點需與 `polygon` 一一對應，切開會失真。
 * 帶 `elevations` 的折線與圓管，切出的各段逐頂點取原縱斷面的高程；
 * 兩端高程不同的斜帶量體照切，切出的各段依弧長內插自己那一段的兩端高程。
 */
export function clipToCoverage(feature: Feature): Feature[] {
  if (feature.kind === "terrain") return [feature];
  const ring = coverageRingFor(feature.layer);
  const { polygon, polygonTop, polyline, tube } = feature.geometry;

  if (polygon && polygon.length >= 3) {
    if (outsideBounds(polygon, ring)) return [];
    if (polygonTop) return insideRing(polygonCentroid(polygon), ring) ? [feature] : [];
    return pieces(feature, clipPolygonToRing(polygon, ring), "polygon");
  }
  const line = polyline && polyline.length >= 2 ? polyline : tube && tube.length >= 2 ? tube : undefined;
  if (!line) return [feature];
  const key = line === polyline ? "polyline" : "tube";
  if (outsideBounds(line, ring)) return [];
  const parts = splitPolylineByRing(line, ring).inside;
  if (feature.elevations !== undefined) {
    const at = elevationAt(feature);
    const length = polylineLength(line);
    return parts.map((part, n) => {
      const fractions = fractionsAlong(line, part);
      const elevations = fractions.map((f) => at(f * length));
      return {
        ...feature,
        id: parts.length === 1 ? feature.id : `${feature.id}#${n}`,
        geometry: { ...feature.geometry, [key]: part },
        elevations,
        base: elevations[0],
      };
    });
  }
  if (feature.baseEnd === undefined) return pieces(feature, parts, key);
  // 兩端高程依弧長線性內插，切出的各段各自保留自己那一段的坡度；圓管的軸心高程同理
  const base = feature.base ?? GROUND_EL;
  const span = feature.baseEnd - base;
  return parts.map((part, n) => {
    const [from, to] = fractionsAlong(line, [part[0], part[part.length - 1]]);
    return {
      ...feature,
      id: parts.length === 1 ? feature.id : `${feature.id}#${n}`,
      geometry: { ...feature.geometry, [key]: part },
      base: base + span * from,
      baseEnd: base + span * to,
    };
  });
}
