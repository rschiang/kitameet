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
import { levelOf, railLevelOf, type StructureId } from "./levels.ts";
import { buildStationComplex } from "./structures/station-complex.ts";
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
};

function buildingHeight(tags: Record<string, string>): number {
  const h = Number(tags.height);
  if (Number.isFinite(h) && h > 0) return h;
  const levels = Number(tags["building:levels"]);
  const n = Number.isFinite(levels) && levels > 0 ? levels : DEFAULT_BUILDING_LEVELS;
  return n * BUILDING_LEVEL_HEIGHT;
}

/** 依類型、樓層與所屬構造物決定量體的底面高程與高度。 */
function volumeOf(
  kind: FeatureKind,
  level: LevelId,
  structure: StructureId | undefined,
  tags: Record<string, string>,
): { base: number; height: number; confidence: Confidence } {
  switch (kind) {
    case "platform":
      // 月台面與該層樓板齊平，量體自軌道面長出
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
  if (override.exclude === true) return null;
  const kind: FeatureKind = (override.kind ?? osm.kind) as FeatureKind;

  const level = override.level ?? levelFromOsm(kind, osm.level);
  const structure = override.structure;
  const isLandmark = LANDMARK_IDS[osm.id] !== undefined && kind === "building";
  const layer: LayerId =
    override.layer ?? (isLandmark ? "landmark" : (LAYER_BY_KIND[kind] ?? "building"));
  const volume = volumeOf(kind, level, structure, osm.tags);

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
  if (structure !== undefined) feature.structure = structure;
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

let cached: Feature[] | null = null;

/** 現況場景的完整量體清單：OSM ＋ 覆寫 ＋ 分層構造。 */
export function buildBaseline(): Feature[] {
  if (cached) return cached;

  const byId = new Map<string, Feature>();
  // 地下資料優先，地面資料僅補足未出現的量體
  for (const osm of [...underground.features, ...surface.features]) {
    if (byId.has(osm.id)) continue;
    const feature = convert(osm);
    if (feature) byId.set(osm.id, feature);
  }

  const features = [...byId.values(), ...buildStationComplex()];
  cached = features;
  return features;
}

/** 以 id 取得現況量體，供方案資料引用既有幾何。 */
export function baselineById(id: string): Feature | undefined {
  return buildBaseline().find((f) => f.id === id);
}
