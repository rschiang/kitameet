/**
 * 合併 OSM 產出與文獻覆寫，產生渲染用的 {@link Feature} 清單。
 * 幾何一律為局部公尺座標，不在此處做任何經緯度換算。
 */
import type { Local } from "../geo/project.ts";
import undergroundJson from "./osm/underground.json";
import surfaceJson from "./osm/surface.json";
import type { OsmDataset, OsmFeature } from "./osm-types.ts";
import {
  BUILDING_LEVEL_HEIGHT,
  DEFAULT_BUILDING_LEVELS,
  LANDMARK_IDS,
  OVERRIDES,
  STATION_BOX_BOTTOM,
  STATION_OUTLINE_ID,
  levelFromOsm,
} from "./overrides.ts";
import {
  LEVELS,
  PLATFORM_RISE,
  railLevel,
  type Confidence,
  type Feature,
  type FeatureKind,
  type LayerId,
  type LevelId,
} from "./schema.ts";

const underground = undergroundJson as unknown as OsmDataset;
const surface = surfaceJson as unknown as OsmDataset;

export const DATA_PROVENANCE = {
  overpassTimestamp: underground.overpassTimestamp,
  generatedAt: underground.generatedAt,
} as const;

/** 股道量體寬度與厚度（公尺）。 */
export const TRACK_BAND_WIDTH = 3.0;
export const TRACK_BAND_THICKNESS = 0.3;
/** 通道與樓板厚度（公尺）。 */
export const SLAB_THICKNESS = 0.4;

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
};

function buildingHeight(tags: Record<string, string>): number {
  const h = Number(tags.height);
  if (Number.isFinite(h) && h > 0) return h;
  const levels = Number(tags["building:levels"]);
  const n = Number.isFinite(levels) && levels > 0 ? levels : DEFAULT_BUILDING_LEVELS;
  return n * BUILDING_LEVEL_HEIGHT;
}

/** 依類型與樓層決定量體的底面高程與高度。 */
function volumeOf(
  kind: FeatureKind,
  level: LevelId,
  tags: Record<string, string>,
): { base: number; height: number; confidence: Confidence } {
  switch (kind) {
    case "platform":
      // 月台面與該層樓板齊平，量體自軌道面長出
      return { base: railLevel(level), height: PLATFORM_RISE, confidence: "derived" };
    case "track-hsr":
    case "track-tra":
    case "track-metro":
      return { base: railLevel(level), height: TRACK_BAND_THICKNESS, confidence: "derived" };
    case "underground-mall":
    case "station":
      return {
        base: LEVELS[level].floor,
        height: LEVELS[level].height - 1.5,
        confidence: "estimated",
      };
    case "passage":
      return { base: LEVELS[level].floor, height: 4.0, confidence: "estimated" };
    case "slab":
      return { base: LEVELS[level].floor - SLAB_THICKNESS, height: SLAB_THICKNESS, confidence: "estimated" };
    case "elevated-road":
      return { base: LEVELS.elevated.floor, height: 0.8, confidence: "estimated" };
    case "road":
      return { base: 0.05, height: 0.1, confidence: "derived" };
    default: {
      const height = buildingHeight(tags);
      const sourced = Number.isFinite(Number(tags.height)) && Number(tags.height) > 0;
      return { base: 0, height, confidence: sourced ? "derived" : "estimated" };
    }
  }
}

function convert(osm: OsmFeature): Feature | null {
  const override = OVERRIDES[osm.id] ?? {};
  const kind: FeatureKind = (override.kind ?? osm.kind) as FeatureKind;
  if (kind === ("other" as FeatureKind)) return null;

  const level = override.level ?? levelFromOsm(kind, osm.level);
  const isLandmark = LANDMARK_IDS[osm.id] !== undefined && kind === "building";
  const layer: LayerId =
    override.layer ?? (isLandmark ? "landmark" : (LAYER_BY_KIND[kind] ?? "building"));
  const volume = volumeOf(kind, level, osm.tags);

  const feature: Feature = {
    id: osm.id,
    kind: isLandmark ? "landmark" : kind,
    level,
    layer,
    geometry: osm.polygon ? { polygon: osm.polygon } : { polyline: osm.polyline ?? [] },
    base: override.base ?? volume.base,
    height: override.height ?? volume.height,
    confidence: override.confidence ?? volume.confidence,
    status: "existing",
  };
  const name = override.name ?? LANDMARK_IDS[osm.id] ?? osm.name;
  if (name !== undefined) feature.name = name;
  if (override.sourceNote !== undefined) feature.sourceNote = override.sourceNote;
  if (kind === "track-hsr" || kind === "track-tra" || kind === "track-metro") {
    feature.width = TRACK_BAND_WIDTH;
  }
  if (feature.geometry.polyline && feature.geometry.polyline.length < 2) return null;
  if (feature.geometry.polygon && feature.geometry.polygon.length < 3) return null;
  return feature;
}

/** 站體各層樓板：平面取 OSM 站體輪廓，深度依 LEVELS 推估。 */
function stationSlabs(outline: Local[]): Feature[] {
  const levels: LevelId[] = ["B1", "B2", "B3"];
  return levels.map((level) => ({
    id: `station-slab/${level}`,
    kind: "slab" as const,
    name: `臺北車站 ${LEVELS[level].label}樓板`,
    level,
    layer: "station-box" as const,
    geometry: { polygon: outline },
    base: LEVELS[level].floor - SLAB_THICKNESS,
    height: SLAB_THICKNESS,
    confidence: "estimated" as const,
    sourceNote: "樓板高程依地上 6 層地下 4 層、總高 48 公尺推估，平面取 OSM 站體輪廓。",
    status: "existing" as const,
  }));
}

/** 站體地下量體：自地面至 B4 結構底，平面取 OSM 站體輪廓。 */
function stationBox(outline: Local[]): Feature {
  return {
    id: "station-box/underground",
    kind: "station-box",
    name: "臺北車站地下量體",
    level: "B4",
    layer: "station-box",
    geometry: { polygon: outline },
    base: STATION_BOX_BOTTOM,
    height: -STATION_BOX_BOTTOM - 0.5,
    confidence: "estimated",
    sourceNote:
      "地下 4 層的開挖範圍以 OSM 站體輪廓推估，結構底取 −33.5 公尺；實際地下連續壁位置未知。",
    status: "existing",
  };
}

let cached: Feature[] | null = null;

/** 現況場景的完整量體清單。 */
export function buildBaseline(): Feature[] {
  if (cached) return cached;

  const byId = new Map<string, Feature>();
  // 地下資料優先，地面資料僅補足未出現的量體
  for (const osm of [...underground.features, ...surface.features]) {
    if (byId.has(osm.id)) continue;
    const feature = convert(osm);
    if (feature) byId.set(osm.id, feature);
  }

  const station = byId.get(STATION_OUTLINE_ID);
  const features = [...byId.values()];
  if (station?.geometry.polygon) {
    features.push(stationBox(station.geometry.polygon), ...stationSlabs(station.geometry.polygon));
  }

  cached = features;
  return features;
}

/** 以 id 取得現況量體，供方案資料引用既有幾何。 */
export function baselineById(id: string): Feature | undefined {
  return buildBaseline().find((f) => f.id === id);
}
