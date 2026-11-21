/**
 * 禁限建公告圖的量體：捷運結構、軌道中心線、限建線，以及 1/1000 地形圖的建物與道路邊線。
 *
 * 幾何全部來自 `scripts/fetch-dorts.ts` 的產出，精度高於 OSM；
 * 深度則一律由 `levels.ts` 的路線軌道面推算，公告圖本身沒有縱剖面。
 */
import {
  nearestOnPolyline,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
} from "../geo/measure.ts";
import { polylineLength } from "../geo/offset.ts";
import undergroundJson from "./osm/underground.json";
import type { OsmDataset } from "./osm-types.ts";
import type { Local } from "../geo/project.ts";
import basemapJson from "./dorts/basemap.json";
import structuresJson from "./dorts/structures.json";
import type { DortsBasemap, DortsLineCode, DortsStructures } from "./dorts-types.ts";
import { METRO_LINES, levelLabelFor, type MetroLineId, type StructureId } from "./levels.ts";
import { BUILDING_LEVEL_HEIGHT, DEFAULT_BUILDING_LEVELS } from "./overrides.ts";
import { TRACK_BAND_WIDTH, type Feature } from "./schema.ts";

const structures = structuresJson as unknown as DortsStructures;
const basemap = basemapJson as unknown as DortsBasemap;
const underground = undergroundJson as unknown as OsmDataset;

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
/** 限建線的帶寬（公尺）。 */
const RESTRICTION_WIDTH = 1.0;

/** 附屬小面繼承 OSM 樓高的門檻：面積須達同一棟最大面的此比例。 */
const MAIN_FACE_RATIO = 0.4;

const SOURCE = "臺北市捷運工程局兩側禁限建範圍公告圖";

/**
 * 量體的所屬路線：以幾何為準，無命中才回退圖幅代號。
 * 圖幅會把鄰線結構當作參考一併繪出（`T` 圖幅畫了松山線的隧道），
 * 僅靠圖幅代號會把鄰線結構塗成自己的顏色、擺到自己的深度。
 */
function lineOf(
  code: DortsLineCode,
  points: Local[],
): { id: MetroLineId; rail: number; label: string; structure: StructureId } {
  const id = dortsLineOf(points) ?? LINE_BY_CODE[code];
  if (id === undefined) throw new Error(`公告圖線路代號 ${code} 未對應到路線`);
  const line = METRO_LINES[id];
  return { id, rail: line.rail, label: line.label, structure: line.structure };
}

/** 以幾何判定所屬路線時，容許的頂點距離中位數上限（公尺）。 */
const LINE_MATCH_DISTANCE = 25;

let osmTracks: { line: MetroLineId; points: Local[] }[] | null = null;

/** OSM 中有 `ref` 的捷運正線，供公告圖量體比對路線。 */
function metroRefTracks(): { line: MetroLineId; points: Local[] }[] {
  if (osmTracks) return osmTracks;
  const byRef: Record<string, MetroLineId> = { BL: "bl", R: "r", G: "g", O: "o", A: "a" };
  osmTracks = [];
  for (const feature of underground.features) {
    if (feature.kind !== "track-metro") continue;
    const line = byRef[feature.tags.ref ?? ""];
    const points = feature.polyline ?? [];
    if (line === undefined || points.length < 2) continue;
    osmTracks.push({ line, points });
  }
  return osmTracks;
}

/** 公告圖量體的所屬路線：頂點到 OSM 正線的距離中位數最小且不超過上限者。 */
export function dortsLineOf(points: Local[]): MetroLineId | undefined {
  if (points.length === 0) return undefined;
  let best: { line: MetroLineId; distance: number } | undefined;
  for (const track of metroRefTracks()) {
    const distances = points
      .map((p) => nearestOnPolyline(p, track.points).distance)
      .sort((a, b) => a - b);
    const median = distances[Math.floor(distances.length / 2)];
    if (best === undefined || median < best.distance) best = { line: track.line, distance: median };
  }
  if (best === undefined || best.distance > LINE_MATCH_DISTANCE) return undefined;
  return best.line;
}

/** 重複判定：某折線 90% 以上的頂點落在另一條 1.5 公尺內，即視為同一條。 */
const DUPLICATE_DISTANCE = 1.5;
const DUPLICATE_COVERAGE = 0.9;

/**
 * 去除相鄰圖幅與鄰線參考畫法造成的重複折線，保留較長者（等長取 id 較小者）。
 * 跨路線的重複會以兩種顏色、兩種深度畫在同一位置，必須去除；
 * 重疊率不足的同線相鄰圖幅片段則保留，其顏色與深度相同，疊合不可見。
 */
function dedupePolylines<T>(
  items: T[],
  pointsOf: (item: T) => Local[],
  idOf: (item: T) => string,
): T[] {
  const lengths = items.map((item) => polylineLength(pointsOf(item)));
  const dropped = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    if (dropped.has(i)) continue;
    for (let j = 0; j < items.length; j++) {
      if (i === j || dropped.has(j)) continue;
      const a = pointsOf(items[i]);
      const covered = a.filter(
        (p) => nearestOnPolyline(p, pointsOf(items[j])).distance <= DUPLICATE_DISTANCE,
      ).length;
      if (covered / a.length < DUPLICATE_COVERAGE) continue;
      const keepOther =
        lengths[j] > lengths[i] ||
        (lengths[j] === lengths[i] && idOf(items[j]) < idOf(items[i]));
      if (keepOther) {
        dropped.add(i);
        break;
      }
    }
  }
  return items.filter((_, i) => !dropped.has(i));
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
  /** 每棟 OSM 建物比對到的面索引；屬性待全部收集完才決定。 */
  const claims = new Map<string, { building: OsmBuildingRef; faces: number[] }>();
  /** 一塊面只承接最先比對到的那一棟：地形圖的面遠小於 OSM 輪廓，重疊者幾乎都是同一棟。 */
  const owner = new Map<number, string>();
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
      if (owner.has(i)) continue;
      owner.set(i, building.id);
      const claim = claims.get(building.id);
      if (claim) claim.faces.push(i);
      else claims.set(building.id, { building, faces: [i] });
    }
    if (matched) replaced.add(building.id);
  }

  // 一棟 OSM 建物常比對到數塊面：主量體以外的附屬小面（騎樓、增建、梯間）
  // 若一併繼承樓高，會在摩天大樓旁長出同高的細柱，因此只有達主量體一定比例者才繼承。
  const attributes = new Map<number, BuildingAttributes>();
  for (const { building, faces: claimed } of claims.values()) {
    const areas = claimed.map((i) => Math.abs(polygonArea(faces[i].polygon)));
    const largest = Math.max(...areas);
    const named = building.name === undefined ? "" : `（${building.name}）`;
    claimed.forEach((i, n) => {
      if (areas[n] >= largest * MAIN_FACE_RATIO) {
        attributes.set(i, {
          height: building.height,
          ...(building.name === undefined ? {} : { name: building.name }),
          landmark: building.landmark,
          sourceNote: `${SOURCE}所附 1/1000 地形圖的房屋輪廓；高度沿用 OSM ${building.id}${named}。`,
        });
        return;
      }
      attributes.set(i, {
        height: Math.min(building.height, DEFAULT_HEIGHT),
        landmark: false,
        sourceNote:
          `${SOURCE}所附 1/1000 地形圖的房屋輪廓；OSM ${building.id}${named}之附屬量體；` +
          `樓高未知，以 ${DEFAULT_BUILDING_LEVELS} 層推估。`,
      });
    });
  }
  return { replaced, attributes };
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

  const bores = dedupePolylines(
    structures.tunnels.flatMap((t) => (t.kind === "bore" ? [t] : [])),
    (t) => t.line,
    (t) => t.id,
  );
  for (const tunnel of bores) {
    const line = lineOf(tunnel.lineCode, tunnel.line);
    const base = line.rail + BORE_AXIS_RISE;
    features.push({
      id: tunnel.id,
      kind: "tunnel",
      name: `捷運${line.label}潛盾隧道`,
      level: levelLabelFor(base),
      structure: line.structure,
      line: line.id,
      layer: "metro",
      geometry: { tube: tunnel.line },
      base,
      height: tunnel.radius * 2,
      radius: tunnel.radius,
      confidence: "estimated",
      sourceNote: `${SOURCE}；深度依${line.label}軌道面 ${line.rail} 公尺推估。`,
      status: "existing",
    });
  }

  for (const tunnel of structures.tunnels) {
    if (tunnel.kind !== "box") continue;
    const line = lineOf(tunnel.lineCode, tunnel.polygon);
    const station = tunnel.width >= STATION_WIDTH;
    const base = line.rail - BOX_BASE_DROP;
    features.push({
      id: tunnel.id,
      kind: station ? "station-box" : "tunnel",
      name: `捷運${line.label}${station ? "車站箱涵" : "明挖箱涵"}`,
      level: levelLabelFor(base),
      structure: line.structure,
      line: line.id,
      layer: "metro",
      geometry: { polygon: tunnel.polygon },
      base,
      height: station ? STATION_TOP - base : BOX_HEIGHT,
      confidence: "estimated",
      sourceNote: `${SOURCE}；深度依${line.label}軌道面 ${line.rail} 公尺推估。`,
      status: "existing",
    });
  }

  const tracks = dedupePolylines(
    structures.tracks,
    (t) => t.line,
    (t) => t.id,
  );
  for (const track of tracks) {
    const line = lineOf(track.lineCode, track.line);
    features.push({
      id: track.id,
      kind: "track-metro",
      name: `捷運${line.label}正線`,
      level: levelLabelFor(line.rail),
      structure: line.structure,
      line: line.id,
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
    const line = lineOf(limit.lineCode, limit.line);
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

  return features;
}
