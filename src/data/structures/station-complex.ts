/**
 * 臺北車站周邊地下構造的分層量體。
 *
 * OSM 只有 2D 輪廓，無法呈現站體、捷運站、機場捷運 A1 站之間的層層交疊，
 * 因此在此依官方車站配置圖與工程文獻，把各構造物拆成逐層的樓板與大廳。
 * B1 的動線（環廊、連通道、階梯、電梯）改由 `concourse.ts` 依 OSM 室內圖資產生。
 * 平面一律由 OSM 輪廓推算，不新增座標常數；
 * 深度一律取 `levels.ts` 中該構造物自己的樓層表。
 */
import { pointInPolygon, polygonCentroid } from "../../geo/measure.ts";
import { dortsStationBoxes } from "../dorts.ts";
import type { Local } from "../../geo/project.ts";
import undergroundJson from "../osm/underground.json";
import surfaceJson from "../osm/surface.json";
import type { OsmDataset } from "../osm-types.ts";
import { STRUCTURES, levelOf, type StructureId } from "../levels.ts";
import {
  SLAB_THICKNESS,
  aboveGround,
  type Feature,
  type FeatureKind,
  type LayerId,
  type LevelId,
  type LineId,
} from "../schema.ts";
import {
  STATION_B1_FOOTPRINT,
  buildB3Concourse,
  buildBannanPlatformAccess,
  buildConcourse,
  buildMetroTransfer,
} from "./concourse.ts";

const underground = undergroundJson as unknown as OsmDataset;
const surface = surfaceJson as unknown as OsmDataset;
// 兩份資料集都查：機場捷運台北車站（A1）的輪廓只標 layer=-2，擷取時歸入地面資料集。
// 同一 id 兩邊都有時取地下資料集，與 `scene.ts` 的優先順序一致
const OSM_POLYGONS = new Map<string, Local[]>(
  [...surface.features, ...underground.features].flatMap((f) =>
    f.polygon ? [[f.id, f.polygon] as const] : [],
  ),
);

/** OSM 輪廓多邊形；缺漏時立即失敗，避免靜默產生空場景。 */
function outline(id: string): Local[] {
  const polygon = OSM_POLYGONS.get(id);
  if (!polygon) throw new Error(`找不到 OSM 輪廓 ${id}`);
  return polygon;
}

const STATION_OUTLINE = "way/23641610";
const BANNAN_PLATFORM = "way/741259904";
const TAMSUI_PLATFORM = "way/741259905";
const A1_OUTLINE = "way/1226069619";

const NOTE = "依官方車站配置圖與工程文獻推估之分層量體，平面由 OSM 輪廓推算。";

function sourceNote(structure: StructureId): string {
  return `${NOTE}${STRUCTURES[structure].sourceNote}`;
}

interface VolumeSpec {
  id: string;
  name: string;
  kind: FeatureKind;
  layer: LayerId;
  structure: StructureId;
  level: LevelId;
  polygon: Local[];
  base: number;
  height: number;
  /** 所屬路線；決定著色。兩線共用的量體不指定。 */
  line?: LineId;
}

function volume(spec: VolumeSpec): Feature {
  const feature: Feature = {
    id: spec.id,
    kind: spec.kind,
    name: spec.name,
    level: spec.level,
    structure: spec.structure,
    layer: spec.layer,
    geometry: { polygon: spec.polygon },
    base: spec.base,
    height: spec.height,
    confidence: "estimated",
    sourceNote: sourceNote(spec.structure),
    status: "existing",
  };
  if (spec.line !== undefined) feature.line = spec.line;
  return feature;
}

/** 某層的樓板：底面自樓板高程再往下一個板厚。 */
function slab(
  id: string,
  name: string,
  layer: LayerId,
  structure: StructureId,
  level: LevelId,
  polygon: Local[],
  line?: LineId,
): Feature {
  return volume({
    id,
    name,
    kind: "slab",
    layer,
    structure,
    level,
    polygon,
    base: levelOf(structure, level).floor - SLAB_THICKNESS,
    height: SLAB_THICKNESS,
    ...(line === undefined ? {} : { line }),
  });
}

/** 某層的室內量體：自樓板長至該層淨高。 */
function room(
  id: string,
  name: string,
  kind: FeatureKind,
  layer: LayerId,
  structure: StructureId,
  level: LevelId,
  polygon: Local[],
  line?: LineId,
): Feature {
  const info = levelOf(structure, level);
  return volume({
    id,
    name,
    kind,
    layer,
    structure,
    level,
    polygon,
    base: info.floor,
    height: info.height,
    ...(line === undefined ? {} : { line }),
  });
}

// ── 臺鐵／高鐵站體 ──────────────────────────────────────

const STATION: StructureId = "tra-hsr-station";

function stationFeatures(): Feature[] {
  const polygon = outline(STATION_OUTLINE);
  const bottom = STRUCTURES[STATION].bottom;
  const features: Feature[] = [
    volume({
      id: "station/box",
      name: "臺北車站地下量體",
      kind: "station-box",
      layer: "station-box",
      structure: STATION,
      level: "B4",
      polygon,
      base: bottom,
      height: aboveGround(-0.5) - bottom,
    }),
  ];

  // B1 的外牆範圍涵蓋東西停車場，遠大於站體建物輪廓
  for (const level of ["B1", "B2", "B3", "B4"] as const) {
    features.push(
      slab(
        `station/slab/${level}`,
        `臺北車站 ${level} 樓板`,
        "station-box",
        STATION,
        level,
        level === "B1" ? STATION_B1_FOOTPRINT : polygon,
      ),
    );
  }

  return features;
}

// ── 捷運台北車站 ────────────────────────────────────────

const METRO: StructureId = "metro-station";
const METRO_R: StructureId = "metro-station-r";

interface MetroBoxes {
  bannan: Local[];
  tamsui: Local[];
}

/**
 * 兩條路線的車站箱涵平面。
 * 平面取自公告圖的車站箱涵（含月台主軸所在者），不再以 OSM 月台軸線推算矩形。
 */
function metroBoxes(): MetroBoxes {
  const bannan = boxContaining(BANNAN_PLATFORM);
  const tamsui = boxContaining(TAMSUI_PLATFORM);
  return { bannan, tamsui };
}

/** 含指定 OSM 月台形心的公告圖車站箱涵；找不到即失敗，不以推算矩形代替。 */
function boxContaining(platformId: string): Local[] {
  const centre = polygonCentroid(outline(platformId));
  const box = dortsStationBoxes().find((polygon) => pointInPolygon(centre, polygon));
  if (!box) throw new Error(`找不到含 OSM 月台 ${platformId} 的公告圖車站箱涵`);
  return box;
}

function metroFeatures(boxes: MetroBoxes): Feature[] {
  const features: Feature[] = [];

  for (const level of ["B1", "B2", "B3"] as const) {
    features.push(
      slab(`metro/bannan/slab/${level}`, `捷運板南線站體 ${level} 樓板`, "metro", METRO, level, boxes.bannan, "bl"),
    );
  }
  features.push(
    room("metro/bannan/concourse/B2", "捷運板南線大廳層（B2）", "station", "metro", METRO, "B2", boxes.bannan, "bl"),
  );

  for (const level of ["B1", "B3", "B4"] as const) {
    features.push(
      slab(`metro/tamsui/slab/${level}`, `捷運淡水信義線站體 ${level} 樓板`, "metro", METRO_R, level, boxes.tamsui, "r"),
    );
  }
  features.push(
    room("metro/tamsui/concourse/B3", "捷運淡水信義線大廳層（B3）", "station", "metro", METRO_R, "B3", boxes.tamsui, "r"),
  );

  return features;
}

// ── 機場捷運 A1 ────────────────────────────────────────

const A1: StructureId = "airport-mrt-a1";

function a1Features(): Feature[] {
  const polygon = outline(A1_OUTLINE);
  const bottom = STRUCTURES[A1].bottom;
  const features: Feature[] = [
    volume({
      id: "a1/box",
      name: "機場捷運台北車站地下量體",
      kind: "station-box",
      layer: "station-box",
      structure: A1,
      level: "B4",
      polygon,
      base: bottom,
      height: aboveGround(-0.5) - bottom,
      line: "a",
    }),
    room("a1/concourse/B1", "機場捷運車站大廳（B1）", "station", "metro", A1, "B1", polygon, "a"),
  ];

  for (const level of ["B1", "B2", "B3", "B4"] as const) {
    features.push(
      slab(`a1/slab/${level}`, `機場捷運台北車站 ${level} 樓板`, "metro", A1, level, polygon, "a"),
    );
  }
  return features;
}

/**
 * 臺北車站站區的分層地下構造。捷運月台的梯組依 `platformOf` 給出的月台平面配置：
 * 場景中的月台已依相鄰軌道重建，梯組須落在重建後的月台上。
 */
export function buildStationComplex(platformOf: (id: string) => Local[]): Feature[] {
  const boxes = metroBoxes();
  return [
    ...stationFeatures(),
    ...metroFeatures(boxes),
    ...a1Features(),
    ...buildConcourse(),
    ...buildB3Concourse(boxes.tamsui),
    ...buildMetroTransfer(boxes.bannan, boxes.tamsui, platformOf(TAMSUI_PLATFORM)),
    ...buildBannanPlatformAccess(platformOf(BANNAN_PLATFORM)),
  ];
}
