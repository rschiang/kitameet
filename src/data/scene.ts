/**
 * 合併 OSM 產出與文獻覆寫，產生渲染用的 {@link Feature} 清單。
 * 幾何一律為局部公尺座標，不在此處做任何經緯度換算。
 */
import undergroundJson from "./osm/underground.json";
import surfaceJson from "./osm/surface.json";
import type { OsmDataset, OsmFeature } from "./osm-types.ts";
import {
  BUILDING_LEVEL_HEIGHT,
  DEFAULT_BUILDING_LEVELS,
  LANDMARK_IDS,
  OVERRIDES,
  levelFromOsm,
} from "./overrides.ts";
import {
  buildDorts,
  dortsReplacesMetroTrack,
  matchDortsBuildings,
  type OsmBuildingRef,
} from "./dorts.ts";
import {
  nearestOnPolyline,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
} from "../geo/measure.ts";
import { corridorPolygon, polylineLength } from "../geo/offset.ts";
import { polygonize } from "../geo/polygonize.ts";
import { TERRAIN_DEPTH, OVERGROUND_RING, clipToCoverage } from "./coverage.ts";
import type { Local } from "../geo/project.ts";
import {
  METRO_LINES,
  levelLabelFor,
  levelOf,
  railLevelOf,
  type MetroLineId,
  type StructureId,
} from "./levels.ts";
import { buildLandmarks, landmarkClaims } from "./structures/landmarks/index.ts";
import { buildStationComplex } from "./structures/station-complex.ts";
import { RAMP_GIRDER, VIADUCT_GIRDER, buildViaduct } from "./structures/viaduct.ts";
import {
  LEVELS,
  PLATFORM_RISE,
  SLAB_THICKNESS,
  TRACK_BAND_THICKNESS,
  TRACK_BAND_WIDTH,
  type Confidence,
  type Feature,
  type FeatureKind,
  type LayerId,
  type LevelId,
  type LineId,
} from "./schema.ts";

const underground = undergroundJson as unknown as OsmDataset;
const surface = surfaceJson as unknown as OsmDataset;

export const DATA_PROVENANCE = {
  overpassTimestamp: underground.overpassTimestamp,
  generatedAt: underground.generatedAt,
} as const;

const LAYER_BY_KIND: Record<string, LayerId> = {
  platform: "platform",
  "track-hsr": "track",
  "track-tra": "track",
  "track-metro": "metro",
  "underground-mall": "mall",
  station: "station-box",
  building: "building",
  "elevated-road": "elevated-road",
  road: "road",
  water: "ground",
  sand: "ground",
  green: "ground",
  plaza: "ground",
};

/** 人行橋隧依樓層歸入高架或地面道路圖層；其餘類型查 {@link LAYER_BY_KIND}。 */
function layerOf(kind: FeatureKind, level: LevelId): LayerId {
  if (kind === "footway") return level === "elevated" ? "elevated-road" : "road";
  return LAYER_BY_KIND[kind] ?? "building";
}

/**
 * 無高度標籤時的推估高度（公尺）：雨棚、通風井等附屬構造不適用一般樓層數。
 * 這些量體佔地可達數百平方公尺，以 4 層推估會在站前廣場上長出實心方塊。
 */
const ANCILLARY_HEIGHT: Record<string, number> = {
  roof: 4.5,
  service: 3.5,
  shed: 3.0,
  garage: 3.0,
  toilets: 3.0,
};

/** 通風井的推估高度（公尺）。 */
const VENT_HEIGHT = 3.5;

/** 雨棚頂板厚度（公尺）。 */
const ROOF_SLAB = 0.3;

function buildingHeight(tags: Record<string, string>): number {
  const h = Number(tags.height);
  if (Number.isFinite(h) && h > 0) return h;
  if (tags.man_made === "ventilation_shaft") return VENT_HEIGHT;
  const ancillary = ANCILLARY_HEIGHT[tags.building ?? ""];
  if (ancillary !== undefined) return ancillary;
  const levels = Number(tags["building:levels"]);
  const n = Number.isFinite(levels) && levels > 0 ? levels : DEFAULT_BUILDING_LEVELS;
  return n * BUILDING_LEVEL_HEIGHT;
}

/** OSM `ref` 對應捷運路線；未列出者無路線識別，維持中性色與預設深度。 */
const METRO_REF: Record<string, MetroLineId> = { BL: "bl", R: "r", G: "g", O: "o", A: "a" };

/**
 * 臺鐵與高鐵的軌道一律位於站體 B2 月台層：本模型範圍（延平北路至華山）全段地下化，
 * OSM 的 `layer` 僅表示繪圖壓線順序（同一條正線出現 −1、−2、−3 三種值），不可當深度用。
 */
const RAIL_STRUCTURE: StructureId = "tra-hsr-station";
const RAIL_LEVEL: LevelId = "B2";

/** 無 `ref` 的橫渡線、側線與機廠線以幾何歸隊時，容許的頂點距離中位數上限（公尺）。 */
const LINE_MATCH_DISTANCE = 40;

let refTracks: { line: MetroLineId; points: Local[] }[] | null = null;

/** 有 `ref` 的捷運正線，供無 `ref` 者比對。 */
function metroRefTracks(): { line: MetroLineId; points: Local[] }[] {
  if (refTracks) return refTracks;
  const seen = new Set<string>();
  refTracks = [];
  for (const osm of [...underground.features, ...surface.features]) {
    if (osm.kind !== "track-metro" || seen.has(osm.id)) continue;
    seen.add(osm.id);
    const line = METRO_REF[osm.tags.ref ?? ""];
    const points = osm.polyline ?? [];
    if (line === undefined || points.length < 2) continue;
    refTracks.push({ line, points });
  }
  return refTracks;
}

/**
 * 無 `ref` 的橫渡線、側線與機廠線歸隊：取各頂點到某條正線的距離中位數，
 * 最小者即其所屬路線；中位數超過 {@link LINE_MATCH_DISTANCE} 即不猜。
 */
function metroLineByProximity(polyline: Local[]): MetroLineId | undefined {
  if (polyline.length < 2) return undefined;
  let best: { line: MetroLineId; distance: number } | undefined;
  for (const track of metroRefTracks()) {
    const distances = polyline
      .map((p) => nearestOnPolyline(p, track.points).distance)
      .sort((a, b) => a - b);
    const median = distances[Math.floor(distances.length / 2)];
    if (best === undefined || median < best.distance) best = { line: track.line, distance: median };
  }
  if (best === undefined || best.distance > LINE_MATCH_DISTANCE) return undefined;
  return best.line;
}

/**
 * 路面寬度（公尺），依 OSM 道路等級；`lanes`、`width` 標籤不在擷取範圍內，故以等級推估。
 * 主線與匝道各自成幅：市民大道高架雙向兩幅合計約 18 公尺寬。
 */
const ROAD_WIDTH: Record<string, number> = {
  primary: 30,
  secondary: 20,
  tertiary: 14,
  pedestrian: 10,
  primary_link: 8,
  tertiary_link: 8,
  trunk_link: 7,
  trunk: 9,
};
const ROAD_WIDTH_DEFAULT = 12;

/** 地面路面的底面高程與厚度（公尺）：薄薄一層鋪面，貼在地塊頂面之上。 */
const ROAD_BASE = 0.02;
const ROAD_THICKNESS = 0.06;
/** 車行地下道的高程與厚度（公尺）。 */
const UNDERPASS_BASE = -5.0;
const UNDERPASS_THICKNESS = 0.6;
/** 匝道落地端的高程（公尺）。 */
const RAMP_GROUND = 0.1;
/** 人行天橋橋面（淨高 4.6 加梁深 0.8）、車行地下道人行段的高程、寬度與板厚（公尺）。 */
const FOOT_BRIDGE_BASE = 5.4;
const FOOT_TUNNEL_BASE = -4.5;
const FOOT_WIDTH = 4;
const FOOT_THICKNESS = 0.5;
/** 只取橋隧的人行路線等級；地面人行道網路不建模。 */
const FOOT_HIGHWAY: Record<string, true> = {
  footway: true,
  steps: true,
  path: true,
  cycleway: true,
};

/** 水域：感潮段水面低於兩岸地面約 3.5 公尺，主槽水深約 6 公尺，均為推估。 */
const WATER_SURFACE = -3.5;
const CHANNEL_BED = -9.5;
/** 面積達此值者視為河道，其餘為池塘（平方公尺）。 */
const CHANNEL_AREA = 50_000;
const POND_BED = -1.2;
const POND_SURFACE = -0.2;
/** 沙洲頂面與厚度（公尺）。 */
const SANDBAR_TOP = -2.0;
const SANDBAR_THICKNESS = 1.5;
/** 公園、綠地與廣場的薄層厚度（公尺）。 */
const GROUND_FILL_THICKNESS = 0.15;

const WATER_NOTE =
  "淡水河、新店溪為感潮河段，水面取低於兩岸地面 3.5 公尺、河床取 9.5 公尺，" +
  "依第十河川分署河道疏濬計畫的航道維護水深推估；池塘另取 1.2 公尺。均為推估值。";

interface RoadVolume {
  kind: FeatureKind;
  level: LevelId;
  base: number;
  baseEnd?: number;
  height: number;
  width: number;
}

/** 高架主線（`highway=trunk` 且在橋上）的中心線，供匝道判定與橋墩定位。 */
let elevatedTrunks: { id: string; points: Local[] }[] | null = null;

function isElevated(tags: Record<string, string>): boolean {
  return tags.bridge === "yes" && Number(tags.layer ?? 0) >= 1;
}

function trunkDecks(): { id: string; points: Local[] }[] {
  if (elevatedTrunks) return elevatedTrunks;
  const seen = new Set<string>();
  elevatedTrunks = [];
  for (const osm of [...underground.features, ...surface.features]) {
    if (seen.has(osm.id)) continue;
    seen.add(osm.id);
    const points = osm.polyline ?? [];
    if (osm.tags.highway !== "trunk" || !isElevated(osm.tags) || points.length < 2) continue;
    elevatedTrunks.push({ id: osm.id, points });
  }
  return elevatedTrunks;
}

/**
 * 匝道鏈各節點的橋面高程。
 *
 * 市民大道的匝道沿主線並行再折下，端點到主線中心線的距離（0–9 公尺）無法辨別高低；
 * 改以路網拓樸判定：與高架主線共節點者為橋面端、與地面道路共節點者為落地端，
 * 其餘節點沿匝道鏈的長度在兩者之間線性內插。高程只與節點有關，
 * 因此被切成數段的同一條匝道在共用節點上必然等高，不會出現段差。
 */
let rampElevations: Map<string, number> | null = null;

const nodeKey = (p: Local): string => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;

/** 自種子節點沿匝道鏈的最短距離；邊數極少，以反覆鬆弛求解。 */
function chainDistances(
  seeds: Set<string>,
  adjacency: Map<string, { to: string; length: number }[]>,
): Map<string, number> {
  const distance = new Map<string, number>();
  const queue: string[] = [];
  for (const seed of seeds) {
    if (!adjacency.has(seed)) continue;
    distance.set(seed, 0);
    queue.push(seed);
  }
  while (queue.length > 0) {
    const node = queue.shift() as string;
    const base = distance.get(node) as number;
    for (const edge of adjacency.get(node) ?? []) {
      const next = base + edge.length;
      if ((distance.get(edge.to) ?? Infinity) <= next) continue;
      distance.set(edge.to, next);
      queue.push(edge.to);
    }
  }
  return distance;
}

function rampNodeElevations(): Map<string, number> {
  if (rampElevations) return rampElevations;
  const deckSeeds = new Set<string>();
  const groundSeeds = new Set<string>();
  const adjacency = new Map<string, { to: string; length: number }[]>();
  const link = (a: string, b: string, length: number) => {
    const list = adjacency.get(a);
    if (list) list.push({ to: b, length });
    else adjacency.set(a, [{ to: b, length }]);
  };

  const seen = new Set<string>();
  for (const osm of [...underground.features, ...surface.features]) {
    if (seen.has(osm.id)) continue;
    seen.add(osm.id);
    const points = osm.polyline ?? [];
    const highway = osm.tags.highway ?? "";
    if (highway === "" || points.length < 2) continue;
    const ends = [nodeKey(points[0]), nodeKey(points[points.length - 1])];
    if (!isElevated(osm.tags)) {
      for (const end of ends) groundSeeds.add(end);
      continue;
    }
    if (highway === "trunk") {
      for (const end of ends) deckSeeds.add(end);
      continue;
    }
    if (!highway.endsWith("_link")) continue;
    const length = polylineLength(points);
    link(ends[0], ends[1], length);
    link(ends[1], ends[0], length);
  }

  const toDeck = chainDistances(deckSeeds, adjacency);
  const toGround = chainDistances(groundSeeds, adjacency);
  const deck = LEVELS.elevated.floor - RAMP_GIRDER;
  rampElevations = new Map();
  for (const node of adjacency.keys()) {
    const deckDistance = toDeck.get(node);
    const groundDistance = toGround.get(node);
    if (groundDistance === undefined) rampElevations.set(node, deck);
    else if (deckDistance === undefined) rampElevations.set(node, RAMP_GROUND);
    else {
      const ratio = deckDistance / (deckDistance + groundDistance);
      rampElevations.set(node, deck + (RAMP_GROUND - deck) * ratio);
    }
  }
  return rampElevations;
}

/**
 * 道路量體：高架與地面的區分一律以 `bridge`／`tunnel`／`layer` 標籤判定，不看路名。
 * 匝道（`*_link`）在高架上時依 {@link rampNodeElevations} 做成斜坡；
 * 人行路線只有天橋與地下道進得了場景，兩者各自成一片薄板。
 */
function roadOf(tags: Record<string, string>, polyline: Local[]): RoadVolume {
  const highway = tags.highway ?? "";
  const width = ROAD_WIDTH[highway] ?? ROAD_WIDTH_DEFAULT;
  if (FOOT_HIGHWAY[highway]) {
    if (tags.tunnel !== undefined) {
      return {
        kind: "footway",
        level: "B1",
        base: FOOT_TUNNEL_BASE,
        height: FOOT_THICKNESS,
        width: FOOT_WIDTH,
      };
    }
    return {
      kind: "footway",
      level: "elevated",
      base: FOOT_BRIDGE_BASE,
      height: FOOT_THICKNESS,
      width: FOOT_WIDTH,
    };
  }
  if (isElevated(tags)) {
    if (highway.endsWith("_link") && polyline.length >= 2) {
      const nodes = rampNodeElevations();
      const deck = LEVELS.elevated.floor - RAMP_GIRDER;
      const base = nodes.get(nodeKey(polyline[0])) ?? deck;
      const end = nodes.get(nodeKey(polyline[polyline.length - 1])) ?? deck;
      return {
        kind: "elevated-road",
        level: "elevated",
        base,
        ...(base === end ? {} : { baseEnd: end }),
        height: RAMP_GIRDER,
        width,
      };
    }
    return {
      kind: "elevated-road",
      level: "elevated",
      base: LEVELS.elevated.floor - VIADUCT_GIRDER,
      height: VIADUCT_GIRDER,
      width,
    };
  }
  if (tags.tunnel === "yes" && Number(tags.layer ?? 0) < 0) {
    // 車行地下道：忠孝西路等路段自路面潛入，寬度取單向一半
    return {
      kind: "road",
      level: "B1",
      base: UNDERPASS_BASE,
      height: UNDERPASS_THICKNESS,
      width: width / 2,
    };
  }
  return { kind: "road", level: "G", base: ROAD_BASE, height: ROAD_THICKNESS, width };
}

/** 依類型、樓層與所屬構造物決定量體的底面高程與高度。 */
function volumeOf(
  kind: FeatureKind,
  level: LevelId,
  structure: StructureId | undefined,
  tags: Record<string, string>,
  polygon: Local[] | undefined,
): { base: number; height: number; confidence: Confidence; note?: string } {
  switch (kind) {
    case "platform":
      // 樓板面即軌道面，月台自樓板長高
      return { base: railLevelOf(structure, level), height: PLATFORM_RISE, confidence: "derived" };
    case "track-hsr":
    case "track-tra":
    case "track-metro":
      return {
        base: railLevelOf(structure, level),
        height: TRACK_BAND_THICKNESS,
        confidence: "derived",
      };
    case "underground-mall":
    case "station": {
      const info = levelOf(structure, level);
      return { base: info.floor, height: info.height, confidence: info.confidence };
    }
    case "passage":
      return { base: levelOf(structure, level).floor, height: 4.0, confidence: "estimated" };
    case "slab":
      return {
        base: levelOf(structure, level).floor - SLAB_THICKNESS,
        height: SLAB_THICKNESS,
        confidence: "estimated",
      };
    case "elevated-road":
      return {
        base: LEVELS.elevated.floor - VIADUCT_GIRDER,
        height: VIADUCT_GIRDER,
        confidence: "estimated",
      };
    case "footway":
      return { base: FOOT_BRIDGE_BASE, height: FOOT_THICKNESS, confidence: "estimated" };
    case "road":
      return { base: ROAD_BASE, height: ROAD_THICKNESS, confidence: "derived" };
    case "water": {
      // 河道與池塘的水深差一個量級，以面積區分
      const channel = polygon !== undefined && Math.abs(polygonArea(polygon)) >= CHANNEL_AREA;
      const base = channel ? CHANNEL_BED : POND_BED;
      const top = channel ? WATER_SURFACE : POND_SURFACE;
      return { base, height: top - base, confidence: "estimated", note: WATER_NOTE };
    }
    case "sand":
      return {
        base: SANDBAR_TOP - SANDBAR_THICKNESS,
        height: SANDBAR_THICKNESS,
        confidence: "estimated",
        note: "沙洲頂面取低於兩岸地面 2 公尺、厚 1.5 公尺，為推估值。",
      };
    case "green":
    case "plaza":
      return { base: 0, height: GROUND_FILL_THICKNESS, confidence: "derived" };
    default: {
      const height = buildingHeight(tags);
      const sourced = Number.isFinite(Number(tags.height)) && Number(tags.height) > 0;
      // 雨棚只是一片頂板，不是實心量體：架在柱上，下方為開放空間
      if (tags.building === "roof") {
        const min = Number(tags.min_height);
        const base = Number.isFinite(min) && min > 0 ? min : Math.max(0, height - ROOF_SLAB);
        return { base, height: Math.max(ROOF_SLAB, height - base), confidence: "estimated" };
      }
      return { base: 0, height, confidence: sourced ? "derived" : "estimated" };
    }
  }
}

function convert(osm: OsmFeature): Feature | null {
  const override = OVERRIDES[osm.id] ?? {};
  if (override.exclude === true) return null;
  // 道路的高架、地面、地下一律重新判定：OSM 產出的 kind 對道路不再具權威性。
  // 已有覆寫指定類型、樓層或構造物者（如標為 highway=corridor 的地下街通道）不適用。
  const roadKind = osm.kind === "road" || osm.kind === "elevated-road" || osm.kind === "footway";
  const overridden =
    override.kind !== undefined || override.level !== undefined || override.structure !== undefined;
  const road = roadKind && !overridden ? roadOf(osm.tags, osm.polyline ?? []) : undefined;
  const kind: FeatureKind = (override.kind ?? road?.kind ?? osm.kind) as FeatureKind;

  // 軌道的深度一律由系統或路線決定，不看 OSM 的 level／layer；其餘類型照 OSM 標籤。
  let level: LevelId;
  let structure: StructureId | undefined;
  let line: LineId | undefined;
  /** 由路線軌道面或道路等級直接給出的底面高程；覆寫指定樓層或構造物時讓位。 */
  let railBase: number | undefined;
  if (kind === "track-tra" || kind === "track-hsr") {
    structure = RAIL_STRUCTURE;
    level = RAIL_LEVEL;
    line = kind === "track-hsr" ? "hsr" : "tra";
  } else if (kind === "track-metro") {
    const metro = METRO_REF[osm.tags.ref ?? ""] ?? metroLineByProximity(osm.polyline ?? []);
    if (metro === undefined) {
      level = levelFromOsm(kind, osm.level);
    } else {
      line = metro;
      structure = METRO_LINES[metro].structure;
      level = levelLabelFor(METRO_LINES[metro].rail);
      railBase = METRO_LINES[metro].rail;
    }
  } else if (road) {
    level = road.level;
    railBase = road.base;
  } else {
    level = levelFromOsm(kind, osm.level);
  }
  if (override.level !== undefined || override.structure !== undefined) railBase = undefined;
  if (override.level !== undefined) level = override.level;
  if (override.structure !== undefined) structure = override.structure;

  const isLandmark = LANDMARK_IDS[osm.id] !== undefined && kind === "building";
  const layer: LayerId = override.layer ?? (isLandmark ? "landmark" : layerOf(kind, level));
  const volume = volumeOf(kind, level, structure, osm.tags, osm.polygon);

  const feature: Feature = {
    id: osm.id,
    kind: isLandmark ? "landmark" : kind,
    level,
    layer,
    geometry: osm.polygon ? { polygon: osm.polygon } : { polyline: osm.polyline ?? [] },
    base: override.base ?? railBase ?? volume.base,
    height: override.height ?? road?.height ?? volume.height,
    confidence: override.confidence ?? volume.confidence,
    status: "existing",
  };
  if (structure !== undefined) feature.structure = structure;
  if (line !== undefined) feature.line = line;
  if (override.baseEnd !== undefined) feature.baseEnd = override.baseEnd;
  else if (road?.baseEnd !== undefined) feature.baseEnd = road.baseEnd;
  const name = override.name ?? LANDMARK_IDS[osm.id] ?? osm.name;
  if (name !== undefined) feature.name = name;
  if (override.sourceNote !== undefined) feature.sourceNote = override.sourceNote;
  else if (volume.note !== undefined) feature.sourceNote = volume.note;
  if (kind === "track-hsr" || kind === "track-tra" || kind === "track-metro") {
    feature.width = TRACK_BAND_WIDTH;
  } else if (road && osm.polygon === undefined) {
    feature.width = road.width;
  }
  if (feature.geometry.polyline && feature.geometry.polyline.length < 2) return null;
  if (feature.geometry.polygon && feature.geometry.polygon.length < 3) return null;
  return feature;
}

/** 道路面合併時的節點量化格距與最小面積（公尺、平方公尺）。 */
const MERGE_SNAP = 0.5;
const MERGE_MIN_AREA = 2;

const MERGE_NOTE = "OSM 道路中心線依等級推估路寬後，同高程的路面合併為單一面。";

/**
 * 可合併的路面：等高的平直帶狀量體。
 * 兩端高程不同的匝道與引道不合併，維持逐條呈現，否則坡度會被壓平。
 */
function mergeableRoad(feature: Feature): boolean {
  if (feature.kind !== "road" && feature.kind !== "elevated-road" && feature.kind !== "footway") {
    return false;
  }
  return (
    (feature.geometry.polyline?.length ?? 0) >= 2 &&
    feature.width !== undefined &&
    feature.base !== undefined &&
    feature.height !== undefined &&
    feature.baseEnd === undefined
  );
}

/** 多邊形依外接矩形登錄格網，供形心的覆蓋判定篩候選。 */
function polygonIndex(polygons: Local[][], cell: number): Map<string, number[]> {
  const index = new Map<string, number[]>();
  polygons.forEach((polygon, i) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of polygon) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    for (let gx = Math.floor(minX / cell); gx <= Math.floor(maxX / cell); gx++) {
      for (let gy = Math.floor(minY / cell); gy <= Math.floor(maxY / cell); gy++) {
        const key = `${gx},${gy}`;
        const list = index.get(key);
        if (list) list.push(i);
        else index.set(key, [i]);
      }
    }
  });
  return index;
}

/** 格網的單一儲存格查詢；形心必在自己的儲存格內，不需查鄰格。 */
const cellAt = (index: Map<string, number[]>, p: Local, cell: number): number[] =>
  index.get(`${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`) ?? [];

/**
 * 重疊的路面帶合併為互不重疊的單一路面網格。
 *
 * 各帶的邊展開為線段集合後交給 {@link polygonize} 求面，重疊處因此被分割為小面；
 * 再保留形心落在任一路面帶內的面，街廓與圓環中央等被道路圍住的面即被捨棄。
 * 合併後不再帶路名，面板沒有逐量體資訊，無使用者可見的損失。
 */
export function mergeRoadSurfaces(features: Feature[]): Feature[] {
  const groups = new Map<string, Feature[]>();
  for (const feature of features) {
    if (!mergeableRoad(feature)) continue;
    const key = `${feature.kind}|${feature.level}|${(feature.base as number).toFixed(2)}|${(feature.height as number).toFixed(2)}`;
    const list = groups.get(key);
    if (list) list.push(feature);
    else groups.set(key, [feature]);
  }

  const merged: Feature[] = [];
  for (const [key, group] of groups) {
    const bands = group.map((f) =>
      corridorPolygon(f.geometry.polyline as Local[], f.width as number),
    );
    const segments: [Local, Local][] = [];
    for (const band of bands) {
      for (let i = 0; i < band.length; i++) segments.push([band[i], band[(i + 1) % band.length]]);
    }
    const faces = polygonize(segments, {
      snap: MERGE_SNAP,
      minArea: MERGE_MIN_AREA,
      maxArea: Number.POSITIVE_INFINITY,
    });

    const cell = 50;
    const bandLookup = polygonIndex(bands, cell);
    const covered = faces.filter((face) => {
      const centre = polygonCentroid(face);
      return cellAt(bandLookup, centre, cell).some((i) => pointInPolygon(centre, bands[i]));
    });

    // `polygonize` 不處理孔洞：完全包在另一條路面帶裡的短路段會另成一面，
    // 與包住它的面重疊。包住者已覆蓋同一塊路面，被包者直接捨棄。
    const areas = covered.map((face) => Math.abs(polygonArea(face)));
    const faceLookup = polygonIndex(covered, cell);
    const kept = covered.filter((face, i) => {
      const centre = polygonCentroid(face);
      return !cellAt(faceLookup, centre, cell).some(
        (j) => j !== i && areas[j] > areas[i] && pointInPolygon(centre, covered[j]),
      );
    });

    const sample = group[0];
    kept.forEach((face, n) => {
      merged.push({
        id: `road/merged/${key}/${n}`,
        kind: sample.kind,
        level: sample.level,
        layer: sample.layer,
        geometry: { polygon: face },
        base: sample.base,
        height: sample.height,
        confidence: "derived",
        sourceNote: MERGE_NOTE,
        status: "existing",
      });
    });
  }
  return merged;
}

let cached: Feature[] | null = null;

/**
 * 現況場景的完整量體清單：OSM ＋ 覆寫 ＋ 分層構造 ＋ 禁限建公告圖。
 *
 * 公告圖涵蓋範圍內的平面幾何一律以公告圖為準：
 * 其建物輪廓取代比對到的 OSM 建物、道路邊線取代 OSM 道路中心線、
 * 軌道中心線取代 OSM 捷運正線。範圍外與無對應者維持 OSM。
 */
export function buildBaseline(): Feature[] {
  if (cached) return cached;

  const byId = new Map<string, Feature>();
  // 地下資料優先，地面資料僅補足未出現的量體
  for (const osm of [...underground.features, ...surface.features]) {
    if (byId.has(osm.id)) continue;
    const feature = convert(osm);
    if (feature) byId.set(osm.id, feature);
  }

  // 涵蓋範圍的裁切須早於公告圖比對：比對依形心判定，裁切會使形心移位，
  // 兩者順序顛倒會讓跨越範圍界線的建物在比對後才變形，與公告圖的房屋面重疊。
  // 裁切後的量體不再進入最後一輪裁切：切口頂點就落在界線上，重切會把它判在界外。
  const clipped = new Map<string, Feature>();
  for (const feature of byId.values()) {
    for (const piece of clipToCoverage(feature)) clipped.set(piece.id, piece);
  }

  const osmBuildings: OsmBuildingRef[] = [];
  for (const feature of clipped.values()) {
    if (feature.kind !== "building" && feature.kind !== "landmark") continue;
    const polygon = feature.geometry.polygon;
    if (!polygon) continue;
    osmBuildings.push({
      id: feature.id,
      polygon,
      height: feature.height ?? DEFAULT_BUILDING_LEVELS * BUILDING_LEVEL_HEIGHT,
      ...(feature.name === undefined ? {} : { name: feature.name }),
      landmark: feature.kind === "landmark",
    });
  }
  const matched = matchDortsBuildings(osmBuildings);

  for (const [id, feature] of clipped) {
    if (matched.replaced.has(id)) {
      clipped.delete(id);
      continue;
    }
    // 公告圖只提供捷運正線的平面；路面一律由 OSM 中心線合併而成
    if (feature.kind === "track-metro" && dortsReplacesMetroTrack(feature.geometry.polyline ?? [])) {
      clipped.delete(id);
    }
  }

  // 橋墩定位依賴逐條高架主線的幾何，必須在道路合併之前取得
  const trunkIds = new Set(trunkDecks().map((deck) => deck.id));
  const decks = [...clipped.values()].filter((f) => trunkIds.has(f.id.split("#")[0]));
  const viaduct = buildViaduct(decks);

  const mergedRoads = mergeRoadSurfaces([...clipped.values()]);
  for (const [id, feature] of clipped) if (mergeableRoad(feature)) clipped.delete(id);

  const claims = landmarkClaims();
  /** 地標認領範圍內的建物面改由細部量體呈現：地形圖常把一座地標切成好幾塊面。 */
  const claimed = (feature: Feature): boolean => {
    if (feature.kind !== "building" && feature.kind !== "landmark") return false;
    const polygon = feature.geometry.polygon;
    if (!polygon) return false;
    const centre = polygonCentroid(polygon);
    return claims.some((claim) => pointInPolygon(centre, claim));
  };

  const features = [...clipped.values()]
    .filter((feature) => !claimed(feature))
    .concat(
      [...mergedRoads, ...viaduct, ...buildStationComplex(), ...buildDorts(matched.attributes)]
        .filter((feature) => !claimed(feature))
        .concat(buildLandmarks())
        .flatMap(clipToCoverage),
    );
  features.push({
    id: "terrain/overground",
    kind: "terrain",
    name: "涵蓋範圍地塊",
    level: "G",
    layer: "terrain",
    geometry: { polygon: OVERGROUND_RING },
    base: -TERRAIN_DEPTH,
    height: TERRAIN_DEPTH,
    confidence: "estimated",
    sourceNote: `地面涵蓋範圍的土方量體，厚度 ${TERRAIN_DEPTH} 公尺為呈現用的設定值，非地質資料。`,
    status: "existing",
  });
  cached = features;
  return features;
}

/** 以 id 取得現況量體，供方案資料引用既有幾何。 */
export function baselineById(id: string): Feature | undefined {
  return buildBaseline().find((f) => f.id === id);
}
