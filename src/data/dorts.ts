/**
 * 禁限建公告圖的量體：捷運結構、軌道中心線、限建線，以及 1/1000 地形圖的建物與道路邊線。
 *
 * 幾何全部來自 `scripts/fetch-dorts.ts` 的產出，精度高於 OSM；
 * 深度則一律由 `levels.ts` 的路線軌道面推算，公告圖本身沒有縱剖面。
 */
import { pointInPolygon, polygonCentroid } from "../geo/measure.ts";
import type { Local } from "../geo/project.ts";
import basemapJson from "./dorts/basemap.json";
import structuresJson from "./dorts/structures.json";
import type { DortsBasemap, DortsLineCode, DortsStructures } from "./dorts-types.ts";
import { METRO_LINES, type MetroLineId, type StructureId } from "./levels.ts";
import { BUILDING_LEVEL_HEIGHT, DEFAULT_BUILDING_LEVELS } from "./overrides.ts";
import { TRACK_BAND_WIDTH, type Feature } from "./schema.ts";

const structures = structuresJson as unknown as DortsStructures;
const basemap = basemapJson as unknown as DortsBasemap;

/** 圖幅線路代號對應路線；未列出者直接擲出，不以預設值矇混。 */
const LINE_BY_CODE: Record<DortsLineCode, MetroLineId> = {
  N: "bl",
  P: "bl",
  T: "r",
  H: "r",
  G: "g",
};

/** 寬度達此值者視為車站箱涵，其餘為明挖箱涵（公尺）。 */
const STATION_WIDTH = 20;
/** 明挖箱涵的淨高（公尺）。 */
const BOX_HEIGHT = 9.0;
/** 車站箱涵的頂版高程（公尺）。 */
const STATION_TOP = -5.0;
/** 潛盾段軸心高出軌道面的距離（公尺）。 */
const BORE_AXIS_RISE = 1.5;
/** 箱涵結構底低於軌道面的距離（公尺）。 */
const BOX_BASE_DROP = 1.5;
/** 限建線與道路邊線的帶寬（公尺）。 */
const RESTRICTION_WIDTH = 1.0;
const ROAD_EDGE_WIDTH = 0.4;

const SOURCE = "臺北市捷運工程局兩側禁限建範圍公告圖";

function lineOf(code: DortsLineCode): { id: MetroLineId; rail: number; label: string; structure: StructureId } {
  const id = LINE_BY_CODE[code];
  if (id === undefined) throw new Error(`公告圖線路代號 ${code} 未對應到路線`);
  const line = METRO_LINES[id];
  return { id, rail: line.rail, label: line.label, structure: line.structure };
}

/** 1/1000 地形圖的建物面；供場景比對與測試使用。 */
export function dortsBuildingPolygons(): Local[][] {
  return basemap.buildings.map((b) => b.polygon);
}

/** 車站箱涵的平面（寬度達 {@link STATION_WIDTH} 者）；站區分層構造以此為樓板平面。 */
export function dortsStationBoxes(): Local[][] {
  return structures.tunnels.flatMap((t) =>
    t.kind === "box" && t.width >= STATION_WIDTH ? [t.polygon] : [],
  );
}

/** 以格網索引點集合，供最近鄰與包含判定。 */
function cellsOf(min: Local, max: Local, cell: number): string[] {
  const keys: string[] = [];
  for (let gx = Math.floor(min[0] / cell); gx <= Math.floor(max[0] / cell); gx++) {
    for (let gy = Math.floor(min[1] / cell); gy <= Math.floor(max[1] / cell); gy++) {
      keys.push(`${gx},${gy}`);
    }
  }
  return keys;
}

function boundsOf(points: Local[]): [Local, Local] {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [
    [Math.min(...xs), Math.min(...ys)],
    [Math.max(...xs), Math.max(...ys)],
  ];
}

/** 公告圖建物面承接 OSM 建物屬性後的高度與名稱。 */
export interface BuildingAttributes {
  height: number;
  name?: string;
  landmark: boolean;
  sourceNote: string;
}

/** 待比對的 OSM 建物。 */
export interface OsmBuildingRef {
  id: string;
  polygon: Local[];
  height: number;
  name?: string;
  landmark: boolean;
}

/**
 * 以幾何判準決定哪些 OSM 建物由公告圖的建物面取代，並把其屬性轉嫁給對應的面。
 *
 * 地形圖把一棟透天厝的每一戶各自畫成一塊，面積多半遠小於 OSM 的整棟輪廓，
 * 因此兩個方向都要判：OSM 形心落在某個面內，或某個面的形心落在 OSM 輪廓內，
 * 都視為同一棟。只判前者會讓涵蓋數塊面的大型 OSM 輪廓留下來與公告圖重疊。
 */
export function matchDortsBuildings(osm: OsmBuildingRef[]): {
  replaced: Set<string>;
  attributes: Map<number, BuildingAttributes>;
} {
  const cell = 25;
  const faces = basemap.buildings.map((b) => ({
    polygon: b.polygon,
    centre: polygonCentroid(b.polygon),
  }));
  const index = new Map<string, number[]>();
  faces.forEach((face, i) => {
    const [min, max] = boundsOf(face.polygon);
    for (const key of cellsOf(min, max, cell)) {
      const list = index.get(key);
      if (list) list.push(i);
      else index.set(key, [i]);
    }
  });

  const replaced = new Set<string>();
  const attributes = new Map<number, BuildingAttributes>();
  for (const building of osm) {
    if (building.polygon.length < 3) continue;
    const [min, max] = boundsOf(building.polygon);
    const centre = polygonCentroid(building.polygon);
    const candidates = new Set(cellsOf(min, max, cell).flatMap((key) => index.get(key) ?? []));
    let matched = false;
    for (const i of candidates) {
      const face = faces[i];
      if (!pointInPolygon(centre, face.polygon) && !pointInPolygon(face.centre, building.polygon)) {
        continue;
      }
      matched = true;
      // 同一塊面可能落在數棟 OSM 輪廓內，取先比對到的那一棟即可：
      // 地形圖的面遠小於 OSM 輪廓，重疊者幾乎都是同一棟的不同畫法。
      if (!attributes.has(i)) {
        attributes.set(i, {
          height: building.height,
          ...(building.name === undefined ? {} : { name: building.name }),
          landmark: building.landmark,
          sourceNote:
            `${SOURCE}所附 1/1000 地形圖的房屋輪廓；` +
            `高度沿用 OSM ${building.id}${building.name === undefined ? "" : `（${building.name}）`}。`,
        });
      }
    }
    if (matched) replaced.add(building.id);
  }
  return { replaced, attributes };
}

/** 道路中心線是否落在公告圖涵蓋範圍內（以折線中點判定）。 */
export function dortsReplacesRoad(polyline: Local[]): boolean {
  if (polyline.length < 2) return false;
  const mid = polyline[Math.floor(polyline.length / 2)];
  return structures.sheets.some((sheet) => pointInPolygon(mid, sheet.ring));
}

/** 捷運正線的全部頂點是否都在公告圖軌道中心線的 20 公尺內。 */
export function dortsReplacesMetroTrack(polyline: Local[]): boolean {
  if (polyline.length < 2) return false;
  return polyline.every((p) => nearestTrackDistance(p) <= TRACK_MATCH_DISTANCE);
}

/** 捷運正線視為同一條的距離上限（公尺）。 */
const TRACK_MATCH_DISTANCE = 20;

let trackIndex: Map<string, [Local, Local][]> | null = null;

/** 某點到最近的公告圖軌道中心線的距離（公尺）。 */
function nearestTrackDistance(point: Local): number {
  const cell = TRACK_MATCH_DISTANCE;
  if (trackIndex === null) {
    trackIndex = new Map();
    for (const track of structures.tracks) {
      for (let i = 1; i < track.line.length; i++) {
        const seg: [Local, Local] = [track.line[i - 1], track.line[i]];
        const [min, max] = boundsOf(seg);
        for (const key of cellsOf(min, max, cell)) {
          const list = trackIndex.get(key);
          if (list) list.push(seg);
          else trackIndex.set(key, [seg]);
        }
      }
    }
  }
  let best = Infinity;
  const gx = Math.floor(point[0] / cell);
  const gy = Math.floor(point[1] / cell);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (const [a, b] of trackIndex.get(`${gx + dx},${gy + dy}`) ?? []) {
        const vx = b[0] - a[0];
        const vy = b[1] - a[1];
        const len2 = vx * vx + vy * vy;
        const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((point[0] - a[0]) * vx + (point[1] - a[1]) * vy) / len2));
        best = Math.min(best, Math.hypot(point[0] - a[0] - vx * t, point[1] - a[1] - vy * t));
      }
    }
  }
  return best;
}

const DEFAULT_HEIGHT = DEFAULT_BUILDING_LEVELS * BUILDING_LEVEL_HEIGHT;

/**
 * 公告圖的量體清單。`attributes` 由場景提供，
 * 以重疊的 OSM 建物補上高度與名稱；沒有對應者取預設樓層數。
 */
export function buildDorts(attributes?: Map<number, BuildingAttributes>): Feature[] {
  const features: Feature[] = [];

  for (const tunnel of structures.tunnels) {
    const line = lineOf(tunnel.lineCode);
    const note = `${SOURCE}；深度依${line.label}軌道面 ${line.rail} 公尺推估。`;
    if (tunnel.kind === "bore") {
      features.push({
        id: tunnel.id,
        kind: "tunnel",
        name: `捷運${line.label}潛盾隧道`,
        level: "B1",
        structure: line.structure,
        layer: "metro",
        geometry: { tube: tunnel.line },
        base: line.rail + BORE_AXIS_RISE,
        height: tunnel.radius * 2,
        radius: tunnel.radius,
        confidence: "estimated",
        sourceNote: note,
        status: "existing",
      });
      continue;
    }
    const station = tunnel.width >= STATION_WIDTH;
    const base = line.rail - BOX_BASE_DROP;
    features.push({
      id: tunnel.id,
      kind: station ? "station-box" : "tunnel",
      name: `捷運${line.label}${station ? "車站箱涵" : "明挖箱涵"}`,
      level: "B1",
      structure: line.structure,
      layer: "metro",
      geometry: { polygon: tunnel.polygon },
      base,
      height: station ? STATION_TOP - base : BOX_HEIGHT,
      confidence: "estimated",
      sourceNote: note,
      status: "existing",
    });
  }

  for (const track of structures.tracks) {
    const line = lineOf(track.lineCode);
    features.push({
      id: track.id,
      kind: "track-metro",
      name: `捷運${line.label}正線`,
      level: "B1",
      structure: line.structure,
      layer: "track",
      geometry: { polyline: track.line },
      base: line.rail,
      height: 0.3,
      width: TRACK_BAND_WIDTH,
      confidence: "estimated",
      sourceNote: `${SOURCE}；軌道面高程依${line.label}推估。`,
      status: "existing",
    });
  }

  for (const limit of structures.restrictionLines) {
    const line = lineOf(limit.lineCode);
    features.push({
      id: limit.id,
      kind: "restriction",
      name: `捷運${line.label}限建線`,
      level: "G",
      layer: "restriction",
      geometry: { polyline: limit.line },
      base: 0.05,
      height: 0.1,
      width: RESTRICTION_WIDTH,
      confidence: "sourced",
      sourceNote: `${SOURCE}：結構外緣兩側 50 公尺的限建範圍界線。`,
      status: "existing",
    });
  }

  basemap.buildings.forEach((building, index) => {
    const attrs = attributes?.get(index) ?? null;
    features.push({
      id: building.id,
      kind: attrs?.landmark === true ? "landmark" : "building",
      ...(attrs?.name === undefined ? {} : { name: attrs.name }),
      level: "G",
      layer: attrs?.landmark === true ? "landmark" : "building",
      geometry: { polygon: building.polygon },
      base: 0,
      height: attrs?.height ?? DEFAULT_HEIGHT,
      confidence: "estimated",
      sourceNote:
        attrs?.sourceNote ??
        `${SOURCE}所附 1/1000 地形圖的房屋輪廓；OSM 無對應建物，樓層數未知，` +
          `高度以 ${DEFAULT_BUILDING_LEVELS} 層推估。`,
      status: "existing",
    });
  });

  for (const road of basemap.roadEdges) {
    features.push({
      id: road.id,
      kind: "road",
      level: "G",
      layer: "road",
      geometry: { polyline: road.line },
      base: 0.05,
      height: 0.1,
      width: ROAD_EDGE_WIDTH,
      confidence: "sourced",
      sourceNote: `${SOURCE}所附 1/1000 地形圖的道路邊線。`,
      status: "existing",
    });
  }

  return features;
}
