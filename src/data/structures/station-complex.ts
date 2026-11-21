/**
 * 臺北車站周邊地下構造的分層量體。
 *
 * OSM 只有 2D 輪廓，無法呈現站體、捷運站、機場捷運 A1 站之間的層層交疊，
 * 因此在此依官方車站配置圖與工程文獻，把各構造物拆成逐層的樓板、大廳、月台、
 * 通道與垂直動線。平面一律由 OSM 輪廓推算，不新增座標常數；
 * 深度一律取 `levels.ts` 中該構造物自己的樓層表。
 */
import {
  advance,
  nearestPair,
  pointInPolygon,
  polygonAxis,
  polygonCentroid,
  type PolygonAxis,
} from "../../geo/measure.ts";
import { dortsStationBoxes } from "../dorts.ts";
import { corridorPolygon } from "../../geo/offset.ts";
import type { Local } from "../../geo/project.ts";
import undergroundJson from "../osm/underground.json";
import surfaceJson from "../osm/surface.json";
import type { OsmDataset } from "../osm-types.ts";
import { STRUCTURES, levelOf, type StructureId } from "../levels.ts";
import {
  SLAB_THICKNESS,
  type Feature,
  type FeatureKind,
  type LayerId,
  type LevelId,
  type LineId,
} from "../schema.ts";

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
const MALL_K = "way/450732441";
const MALL_Z = "way/328691510";
const MALL_Y = "way/450732440";
const MALL_R = "way/450732442";

const NOTE = "依官方車站配置圖與工程文獻推估之分層量體，平面由 OSM 輪廓推算。";

// ── 站體（臺鐵／高鐵） ──────────────────────────────────
/** B1 南北向通道條數與寬度（公尺）。 */
const PASSAGE_WIDTH = 12.0;
/** 5 條通道沿主軸的相對位置。 */
const PASSAGE_POSITIONS = [-1 / 3, -1 / 6, 0, 1 / 6, 1 / 3];
const PASSAGE_NAMES = ["第二西通道", "西通道", "中央通道", "東通道", "第二東通道"];
/** 通道南端延伸至站體南緣外、北端延伸至北緣外的距離（公尺）。 */
const PASSAGE_SOUTH_REACH = 55;
const PASSAGE_NORTH_REACH = 10;
/** 南、北迴廊寬度與其距站體邊緣的距離（公尺）。 */
const CORRIDOR_WIDTH = 10.0;
const CORRIDOR_INSET = 14;

// ── 捷運台北車站 ────────────────────────────────────────
/** 垂直動線核心邊長（公尺）與其沿箱涵主軸中點兩側的位置。 */
const CORE_SIZE = 6;
const CORE_OFFSET = 60;

/** 地下街連通道寬度（公尺）；兩端已相鄰時不畫。 */
const LINK_WIDTH = 10.0;
const LINK_MIN_DISTANCE = 5;

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

/** 以中心點與邊長產生正方形量體的輪廓。 */
function square(centre: Local, size: number): Local[] {
  const half = size / 2;
  return [
    [centre[0] - half, centre[1] - half],
    [centre[0] + half, centre[1] - half],
    [centre[0] + half, centre[1] + half],
    [centre[0] - half, centre[1] + half],
  ];
}

// ── 臺鐵／高鐵站體 ──────────────────────────────────────

const STATION: StructureId = "tra-hsr-station";

function stationFeatures(): Feature[] {
  const polygon = outline(STATION_OUTLINE);
  const axis = polygonAxis(polygon);
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
      height: -bottom - 0.5,
    }),
  ];

  for (const level of ["B1", "B2", "B3", "B4"] as const) {
    features.push(
      slab(`station/slab/${level}`, `臺北車站 ${level} 樓板`, "station-box", STATION, level, polygon),
    );
  }

  // B1 穿堂層：5 條南北向通道，南端穿出站體接站前廣場與地下街
  const northward = axis.bearing + 90;
  PASSAGE_POSITIONS.forEach((fraction, index) => {
    const mid = advance(axis.center, axis.bearing, fraction * axis.length);
    const centre: Local[] = [
      advance(mid, northward, -(axis.width / 2 + PASSAGE_SOUTH_REACH)),
      advance(mid, northward, axis.width / 2 + PASSAGE_NORTH_REACH),
    ];
    const name = PASSAGE_NAMES[index];
    features.push(
      room(
        `station/passage/${name}`,
        `臺北車站 ${name}（B1）`,
        "passage",
        "passage",
        STATION,
        "B1",
        corridorPolygon(centre, PASSAGE_WIDTH),
      ),
    );
  });

  // B1 南、北迴廊：平行主軸，貫通五條通道
  for (const [side, sign] of [
    ["north", 1],
    ["south", -1],
  ] as const) {
    const mid = advance(axis.center, northward, sign * (axis.width / 2 - CORRIDOR_INSET));
    const centre: Local[] = [
      advance(mid, axis.bearing, -axis.length / 2),
      advance(mid, axis.bearing, axis.length / 2),
    ];
    features.push(
      room(
        `station/corridor/${side}`,
        `臺北車站 ${side === "north" ? "北" : "南"}迴廊（B1）`,
        "passage",
        "passage",
        STATION,
        "B1",
        corridorPolygon(centre, CORRIDOR_WIDTH),
      ),
    );
  }

  return features;
}

// ── 捷運台北車站 ────────────────────────────────────────

const METRO: StructureId = "metro-station";

interface MetroBoxes {
  bannan: Local[];
  tamsui: Local[];
  junction: Local;
}

/**
 * 兩條路線的車站箱涵平面與其交會處。
 * 平面取自公告圖的車站箱涵（含月台主軸所在者），不再以 OSM 月台軸線推算矩形。
 */
function metroBoxes(): MetroBoxes {
  const bannan = boxContaining(BANNAN_PLATFORM);
  const tamsui = boxContaining(TAMSUI_PLATFORM);
  const bannanAxis = polygonAxis(bannan);
  const tamsuiAxis = polygonAxis(tamsui);
  // 兩條箱涵主軸的交點即為轉乘節點
  const junction = axisIntersection(bannanAxis, tamsuiAxis);
  return { bannan, tamsui, junction };
}

/** 含指定 OSM 月台形心的公告圖車站箱涵；找不到即失敗，不以推算矩形代替。 */
function boxContaining(platformId: string): Local[] {
  const centre = polygonCentroid(outline(platformId));
  const box = dortsStationBoxes().find((polygon) => pointInPolygon(centre, polygon));
  if (!box) throw new Error(`找不到含 OSM 月台 ${platformId} 的公告圖車站箱涵`);
  return box;
}

/** 兩條主軸的交點；平行時退回兩軸中點的中點。 */
function axisIntersection(a: PolygonAxis, b: PolygonAxis): Local {
  const ua: Local = [Math.cos((a.bearing * Math.PI) / 180), Math.sin((a.bearing * Math.PI) / 180)];
  const ub: Local = [Math.cos((b.bearing * Math.PI) / 180), Math.sin((b.bearing * Math.PI) / 180)];
  const det = ua[0] * -ub[1] - ua[1] * -ub[0];
  if (Math.abs(det) < 1e-9) return [(a.center[0] + b.center[0]) / 2, (a.center[1] + b.center[1]) / 2];
  const dx = b.center[0] - a.center[0];
  const dy = b.center[1] - a.center[1];
  const t = (dx * -ub[1] - dy * -ub[0]) / det;
  return [a.center[0] + ua[0] * t, a.center[1] + ua[1] * t];
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
      slab(`metro/tamsui/slab/${level}`, `捷運淡水信義線站體 ${level} 樓板`, "metro", METRO, level, boxes.tamsui, "r"),
    );
  }
  features.push(
    room("metro/tamsui/concourse/B3", "捷運淡水信義線大廳層（B3）", "station", "metro", METRO, "B3", boxes.tamsui, "r"),
  );

  // 垂直動線：自最深的月台層貫穿至 B1 樓板，兩線交會處 1 處、各箱涵主軸中點兩側各 1 處
  const deepest: LevelId = "B4";
  const base = levelOf(METRO, deepest).floor;
  const top = levelOf(METRO, "B1").floor;
  const bannanAxis = polygonAxis(boxes.bannan);
  const tamsuiAxis = polygonAxis(boxes.tamsui);
  const cores: Local[] = [
    boxes.junction,
    advance(bannanAxis.center, bannanAxis.bearing, -CORE_OFFSET),
    advance(bannanAxis.center, bannanAxis.bearing, CORE_OFFSET),
    advance(tamsuiAxis.center, tamsuiAxis.bearing, -CORE_OFFSET),
    advance(tamsuiAxis.center, tamsuiAxis.bearing, CORE_OFFSET),
  ];
  cores.forEach((centre, index) => {
    features.push(
      volume({
        id: `metro/core/${index + 1}`,
        name: `捷運垂直動線 ${index + 1}`,
        kind: "passage",
        layer: "metro",
        structure: METRO,
        level: deepest,
        polygon: square(centre, CORE_SIZE),
        base,
        height: top - base,
      }),
    );
  });

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
      height: -bottom - 0.5,
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

// ── 連通道 ──────────────────────────────────────────────

/**
 * 以兩組輪廓的最近點產生 B1 連通道。
 * 兩者已相鄰（最近距離小於 {@link LINK_MIN_DISTANCE}）時不需另畫。
 */
function link(
  id: string,
  name: string,
  structure: StructureId,
  a: Local[],
  b: Local[],
): Feature | null {
  const pair = nearestPair(a, b);
  if (pair.distance < LINK_MIN_DISTANCE) return null;
  return room(id, name, "passage", "passage", structure, "B1", corridorPolygon([pair.a, pair.b], LINK_WIDTH));
}

function linkFeatures(boxes: MetroBoxes): Feature[] {
  const station = outline(STATION_OUTLINE);
  const candidates = [
    link("mall/link/k-z", "K 區地下街 ↔ 站前地下街", "mall-k", outline(MALL_K), outline(MALL_Z)),
    link("mall/link/k-bannan", "K 區地下街 ↔ 捷運板南線", "mall-k", outline(MALL_K), boxes.bannan),
    link("mall/link/z-bannan", "站前地下街 ↔ 捷運板南線", "mall-z", outline(MALL_Z), boxes.bannan),
    link("mall/link/y-station", "台北地下街 ↔ 臺北車站", "mall-y", outline(MALL_Y), station),
    link("mall/link/r-tamsui", "中山地下街 ↔ 捷運淡水信義線", "mall-r", outline(MALL_R), boxes.tamsui),
    link("mall/link/station-bannan", "臺北車站 ↔ 捷運板南線", STATION, station, boxes.bannan),
    link("a1/link/taipei-mall", "機場捷運台北車站 ↔ 台北地下街", A1, outline(A1_OUTLINE), outline(MALL_Y)),
  ];
  return candidates.filter((f): f is Feature => f !== null);
}

/** 臺北車站站區的分層地下構造。 */
export function buildStationComplex(): Feature[] {
  const boxes = metroBoxes();
  return [...stationFeatures(), ...metroFeatures(boxes), ...a1Features(), ...linkFeatures(boxes)];
}
