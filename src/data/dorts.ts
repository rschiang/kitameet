/**
 * 禁限建公告圖的量體：捷運結構、限建線，以及 1/1000 地形圖的建物與道路邊線。
 * 軌道中心線不直接成為量體，由 {@link dortsTrackPolylines} 交給 `structures/metro-network.ts` 組成正線。
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
import { polylineLength, slicePolyline } from "../geo/offset.ts";
import undergroundJson from "./osm/underground.json";
import type { OsmDataset } from "./osm-types.ts";
import type { Local } from "../geo/project.ts";
import basemapJson from "./dorts/basemap.json";
import structuresJson from "./dorts/structures.json";
import type { DortsBasemap, DortsLineCode, DortsStructures } from "./dorts-types.ts";
import { METRO_LINES, levelLabelFor, type MetroLineId, type StructureId } from "./levels.ts";
import { BUILDING_LEVEL_HEIGHT, DEFAULT_BUILDING_LEVELS } from "./overrides.ts";
import { GROUND_EL, aboveGround, type Feature } from "./schema.ts";

const structures = structuresJson as unknown as DortsStructures;
const basemap = basemapJson as unknown as DortsBasemap;
const underground = undergroundJson as unknown as OsmDataset;

/**
 * 公告圖地形底圖已拆除的房屋面：形心座標（局部公尺）與現況。
 *
 * 底圖的製圖年代早於北門周邊 2016 年以後的改建，忠孝西路拓寬、交通八號廣場與
 * 臺北行旅廣場闢建、公車彎啟用與台北雙星整地後拆除的房屋仍留在圖上；
 * 這些面沒有對應的 OSM 建物，`buildDorts()` 會以預設樓層數把它們拉成實心方塊，
 * 立在廣場與車道上。現況一律以國土測繪中心 2024 年版正射影像
 * （WMS `https://wms.nlsc.gov.tw/wms`，`LAYERS=PHOTO2`）逐塊套圖確認。
 * 不以公園面或路廊自動判定：OSM 的公園面常涵蓋既有房屋，會誤刪實際存在的建物。
 */
export const DEMOLISHED_FACES: { at: Local; note: string }[] = [
  { at: [-534.33, 1.58], note: "忠孝西路一段車道，北門東側（dorts/building/523）" },
  { at: [-519.85, -4.26], note: "忠孝西路一段車道，北門東側（dorts/building/540）" },
  { at: [-524.26, 6.15], note: "忠孝西路一段車道，北門東側（dorts/building/553）" },
  { at: [-509.92, 21.53], note: "交通八號廣場西段（dorts/building/532）" },
  { at: [-517.44, 9.96], note: "交通八號廣場西段（dorts/building/558）" },
  { at: [-473.61, 17.86], note: "交通八號廣場（dorts/building/647）" },
  { at: [-459.5, 16.27], note: "交通八號廣場（dorts/building/669）" },
  { at: [-440.61, 10.88], note: "交通八號廣場（dorts/building/715）" },
  { at: [-425.11, 12.69], note: "交通八號廣場東段（dorts/building/722）" },
  { at: [-419.17, 9.09], note: "交通八號廣場東段（dorts/building/757）" },
  { at: [-516.57, 64.19], note: "台北雙星 C1、D1 工地（dorts/building/545）" },
  { at: [-355.76, -33.33], note: "忠孝西路一段北側公車彎（dorts/building/872）" },
  { at: [-368.2, -15.5], note: "忠孝西路一段北側公車彎西端（dorts/building/873）" },
  { at: [-342.67, -62.14], note: "忠孝西路一段車道（dorts/building/923）" },
  { at: [-305.47, -64.02], note: "忠孝西路一段車道（dorts/building/955）" },
  { at: [-293.27, -75.14], note: "忠孝西路一段車道（dorts/building/965）" },
  { at: [-275.23, -69.71], note: "臺北行旅廣場南緣人行道與車道（dorts/building/957）" },
];

/** 形心比對容差（公尺）：清單各點與其餘房屋面形心最近相距 6.9 公尺，1.5 公尺足以唯一命中。 */
export const DEMOLISHED_TOLERANCE = 1.5;

/**
 * 扣除已拆除者的房屋面。本檔與地標取面一律以此清單為準，
 * 其索引即 {@link BuildingAttributes} 的鍵；比對與輸出共用同一份陣列才不會錯位。
 * 以形心座標而非 `id` 指定：`id` 由 `scripts/fetch-dorts.ts` 依空間排序逐一編號，重新擷取會位移。
 */
const buildingFaces = basemap.buildings.filter((building) => {
  const centre = polygonCentroid(building.polygon);
  return !DEMOLISHED_FACES.some(
    (face) => Math.hypot(centre[0] - face.at[0], centre[1] - face.at[1]) <= DEMOLISHED_TOLERANCE,
  );
});

/** 圖幅線路代號對應路線；未列出者直接擲出，不以預設值矇混。 */
const LINE_BY_CODE: Record<DortsLineCode, MetroLineId> = {
  N: "bl",
  P: "bl",
  T: "r",
  H: "r",
  G: "g",
};

/** 寬度達此值者視為車站箱涵，其餘為明挖箱涵（公尺）。 */
export const STATION_WIDTH = 20;
/** 明挖箱涵的淨高（公尺）。 */
export const BOX_HEIGHT = 9.0;
/** 車站箱涵的頂版高程（公尺）。 */
export const STATION_TOP = aboveGround(-5.0);
/** 潛盾段軸心高出軌道面的距離（公尺）。 */
export const BORE_AXIS_RISE = 1.5;
/** 箱涵結構底低於軌道面的距離（公尺）。 */
export const BOX_BASE_DROP = 1.5;
/** 限建線的帶寬（公尺）。 */
const RESTRICTION_WIDTH = 1.0;

/** 附屬小面繼承 OSM 樓高的門檻：面積須達同一棟最大面的此比例。 */
const MAIN_FACE_RATIO = 0.4;

export const SOURCE = "臺北市捷運工程局兩側禁限建範圍公告圖";

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

let osmTracks: { line: MetroLineId; lines: Local[][] }[] | null = null;

/**
 * OSM 中有 `ref` 的捷運正線，依路線分組。
 * 必須整條路線一起比對：同一條路線在 OSM 被切成數十條 way，
 * 逐條取中位數會讓橫跨全線的長 way 勝過近在咫尺的短 way。
 */
function metroRefTracks(): { line: MetroLineId; lines: Local[][] }[] {
  if (osmTracks) return osmTracks;
  const byRef: Record<string, MetroLineId> = { BL: "bl", R: "r", G: "g", O: "o", A: "a" };
  const grouped = new Map<MetroLineId, Local[][]>();
  for (const feature of underground.features) {
    if (feature.kind !== "track-metro") continue;
    const line = byRef[feature.tags.ref ?? ""];
    const points = feature.polyline ?? [];
    if (line === undefined || points.length < 2) continue;
    const group = grouped.get(line);
    if (group) group.push(points);
    else grouped.set(line, [points]);
  }
  osmTracks = [...grouped].map(([line, lines]) => ({ line, lines }));
  return osmTracks;
}

/** 各頂點到該路線最近一條正線的距離，取中位數。 */
export function medianDistanceToLines(points: Local[], lines: Local[][]): number {
  const distances = points
    .map((p) => Math.min(...lines.map((line) => nearestOnPolyline(p, line).distance)))
    .sort((a, b) => a - b);
  return distances[Math.floor(distances.length / 2)];
}

/** 公告圖量體的所屬路線：頂點到該路線的距離中位數最小且不超過上限者。 */
export function dortsLineOf(points: Local[]): MetroLineId | undefined {
  if (points.length === 0) return undefined;
  let best: { line: MetroLineId; distance: number } | undefined;
  for (const track of metroRefTracks()) {
    const median = medianDistanceToLines(points, track.lines);
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
export function dedupePolylines<T>(
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
  return buildingFaces.map((b) => b.polygon);
}

/** 車站箱涵的平面（寬度達 {@link STATION_WIDTH} 者）；站區分層構造以此為樓板平面。 */
export function dortsStationBoxes(): Local[][] {
  return structures.tunnels.flatMap((t) =>
    t.kind === "box" && t.width >= STATION_WIDTH ? [t.polygon] : [],
  );
}

/**
 * 包含 `point` 的車站箱涵平面；沒有即擲例外。數個箱涵都包含時取面積最小者：
 * 淡水線臺北車站—雙連的明挖箱涵寬度也達車站箱涵的門檻，會把站體箱涵整個包住。
 */
export function dortsStationBoxAt(point: Local): Local[] {
  const boxes = dortsStationBoxes().filter((polygon) => pointInPolygon(point, polygon));
  if (boxes.length === 0) throw new Error(`公告圖沒有涵蓋 ${point} 的車站箱涵`);
  return boxes.reduce((a, b) => (Math.abs(polygonArea(b)) < Math.abs(polygonArea(a)) ? b : a));
}

let trackPolylines: Local[][] | null = null;

/** 公告圖的軌道中心線（去除相鄰圖幅與鄰線參考畫法的重複）；為筆畫，不是一條條軌道。 */
export function dortsTrackPolylines(): Local[][] {
  trackPolylines ??= dedupePolylines(
    structures.tracks,
    (t) => t.line,
    (t) => t.id,
  ).map((track) => track.line);
  return trackPolylines;
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
  const faces = buildingFaces.map((b) => ({
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

const DEFAULT_HEIGHT = DEFAULT_BUILDING_LEVELS * BUILDING_LEVEL_HEIGHT;

/** 潛盾端部削切：每次削去的長度、檢查的端部長度（公尺）與次數上限。 */
const BORE_TRIM_STEP = 0.5;
const BORE_TRIM_PROBE = 6;
const BORE_TRIM_LIMIT = 40;

/** 折線上弧長 `s` 處的座標與單位切向。 */
function frameAt(pts: Local[], s: number): { point: Local; tangent: Local } {
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (seg === 0) continue;
    const tangent: Local = [(b[0] - a[0]) / seg, (b[1] - a[1]) / seg];
    if (walked + seg >= s || i === pts.length - 1) {
      const t = Math.min(seg, Math.max(0, s - walked));
      return { point: [a[0] + tangent[0] * t, a[1] + tangent[1] * t], tangent };
    }
    walked += seg;
  }
  return { point: pts[0], tangent: [1, 0] };
}

/**
 * 潛盾止於車站端牆：公告圖的潛盾軸線常伸進車站箱涵，圓管端部因而斜穿端牆。
 * 兩端各自檢查端部 {@link BORE_TRIM_PROBE} 公尺內的軸點與兩側管緣，
 * 落在同路線車站箱涵內就自該端削去 {@link BORE_TRIM_STEP} 公尺，直到端部完全在箱涵外。
 */
function trimBoreAtStations(line: Local[], radius: number, boxes: Local[][]): Local[] {
  const intrudes = (part: Local[]): boolean => {
    const length = polylineLength(part);
    for (let s = 0; s <= length + 1e-9; s += BORE_TRIM_STEP) {
      const { point, tangent } = frameAt(part, s);
      const [nx, ny] = [-tangent[1], tangent[0]];
      const probes: Local[] = [
        point,
        [point[0] + nx * radius, point[1] + ny * radius],
        [point[0] - nx * radius, point[1] - ny * radius],
      ];
      if (probes.some((p) => boxes.some((box) => pointInPolygon(p, box)))) return true;
    }
    return false;
  };
  const total = polylineLength(line);
  let from = 0;
  let to = total;
  for (let n = 0; n < BORE_TRIM_LIMIT && to - from > 1; n++) {
    if (!intrudes(slicePolyline(line, from, from + BORE_TRIM_PROBE))) break;
    from += BORE_TRIM_STEP;
  }
  for (let n = 0; n < BORE_TRIM_LIMIT && to - from > 1; n++) {
    if (!intrudes(slicePolyline(line, to - BORE_TRIM_PROBE, to))) break;
    to -= BORE_TRIM_STEP;
  }
  return to - from < 1 ? [] : slicePolyline(line, from, to);
}

/** 公告圖的潛盾範圍：去重、判定路線並削去伸進車站箱涵的端部後的軸線。 */
export interface DortsBore {
  id: string;
  line: MetroLineId;
  label: string;
  structure: StructureId;
  axis: Local[];
  radius: number;
}

let boreCache: DortsBore[] | null = null;

/**
 * 公告圖的潛盾範圍。高程不在此決定：圓管由 `structures/tunnels.ts` 沿所在的正線產生，
 * 本清單只提供平面範圍與管徑。
 */
export function dortsBores(): DortsBore[] {
  if (boreCache) return boreCache;
  const stationBoxes = structures.tunnels.flatMap((t) =>
    t.kind === "box" && t.width >= STATION_WIDTH
      ? [{ line: lineOf(t.lineCode, t.polygon).id, polygon: t.polygon }]
      : [],
  );
  const bores = dedupePolylines(
    structures.tunnels.flatMap((t) => (t.kind === "bore" ? [t] : [])),
    (t) => t.line,
    (t) => t.id,
  );
  boreCache = bores.flatMap((tunnel) => {
    const line = lineOf(tunnel.lineCode, tunnel.line);
    const axis = trimBoreAtStations(
      tunnel.line,
      tunnel.radius,
      stationBoxes.flatMap((box) => (box.line === line.id ? [box.polygon] : [])),
    );
    if (axis.length < 2) return [];
    return [{ id: tunnel.id, line: line.id, label: line.label, structure: line.structure, axis, radius: tunnel.radius }];
  });
  return boreCache;
}

/**
 * 公告圖的量體清單。`attributes` 由場景提供，
 * 以重疊的 OSM 建物補上高度與名稱；沒有對應者取預設樓層數。
 * 潛盾圓管見 {@link dortsBores}；箱涵的高程在此先依路線軌道面給出，
 * 場景再以 `fitBoxesToTracks` 依箱涵內的正線改寫。
 */
export function buildDorts(attributes?: Map<number, BuildingAttributes>): Feature[] {
  const features: Feature[] = [];

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
      sourceNote: `${SOURCE}；深度依${line.label}軌道面 EL ${line.rail} 公尺推估。`,
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
      base: aboveGround(0.05),
      height: 0.1,
      width: RESTRICTION_WIDTH,
      confidence: "sourced",
      sourceNote: `${SOURCE}：結構外緣兩側 50 公尺的限建範圍界線。`,
      status: "existing",
    });
  }

  buildingFaces.forEach((building, index) => {
    const attrs = attributes?.get(index) ?? null;
    features.push({
      id: building.id,
      kind: attrs?.landmark === true ? "landmark" : "building",
      ...(attrs?.name === undefined ? {} : { name: attrs.name }),
      level: "G",
      layer: attrs?.landmark === true ? "landmark" : "building",
      geometry: { polygon: building.polygon },
      base: GROUND_EL,
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
