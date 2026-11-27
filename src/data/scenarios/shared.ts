/**
 * 改建方案的共用建構器：拆除 K 區地下街，於站前廣場下方新建兩座對齊的高鐵島式月台 甲、乙
 * （長 410 公尺、16 節車廂），既有第一、二月台與其包夾四線歸還臺鐵。
 *
 * 各方案只差月台擺放、西側接軌方式、改建區間與東側標稱半徑，由 {@link ScenarioConfig} 給定；
 * 月台位置由既有第一月台的主軸與 K 區地下街東端推算，
 * 股道由月台中心線平移後接回既有高鐵股道在改建界線上的位置。
 * 數值量自研究小組《臺北車站方案 B′ 軌道配置構想》疊圖，
 * 月台寬度與曲線半徑則依本專案的裁示調整（見 docs/proposals.md）。
 */
import { tangentConnector } from "../../geo/alignment.ts";
import { resample } from "../../geo/corridor.ts";
import {
  advance,
  decompose,
  nearestOnPolyline,
  pointInPolygon,
  polygonAxis,
  type PolygonAxis,
} from "../../geo/measure.ts";
import {
  corridorPolygon,
  offsetPolyline,
  polylineBearingAtX,
  polylineCrossingAtX,
  polylineLength,
  splitPolylineAtX,
  taperedOffset,
} from "../../geo/offset.ts";
import type { Local } from "../../geo/project.ts";
import undergroundJson from "../osm/underground.json";
import type { OsmDataset } from "../osm-types.ts";
import { elevationAt, vertexElevations } from "../elevation.ts";
import { buildBaseline, baselineById } from "../scene.ts";
import { levelLabelFor, railLevelOf } from "../levels.ts";
import { profiled } from "../structures/metro-network.ts";
import { arcLengths, MIN_TRACK_SEPARATION, nearestArc, pointAtArc } from "../structures/metro-profile.ts";
import {
  PLATFORM_RISE,
  PLATFORM_WIDTH,
  TRACK_BAND_THICKNESS,
  TRACK_BAND_WIDTH,
  TRACK_OFFSET,
  type Feature,
} from "../schema.ts";

export interface Scenario {
  id: "proposal-b" | "proposal-c";
  label: string;
  /** 拆除的既有量體 id。 */
  removed: string[];
  /** 新建量體。 */
  added: Feature[];
  /** 改作他用的既有量體。 */
  repurposed: { id: string; note: string }[];
  /**
   * 改建段：既有股道在界線某側的部分視為拆除重建。
   * `tra` 指定的沿主軸區間改作臺鐵喉道，不拆除。
   */
  rebuilt: {
    id: string;
    keep: "west" | "east";
    limitX: number;
    note: string;
    tra?: { from: number; to: number };
  }[];
  /**
   * 開挖侵入段：既有構造物落在新建工程開挖範圍內的部分視為拆除重建。
   * `edge` 為包絡邊緣折線（由西往東），其左側（北側）為開挖範圍。
   */
  encroached: { ids: string[]; edge: Local[]; note: string }[];
}

/** 月台擺放：相對既有第一月台主軸的旋轉（度，負為順時針）與平移（公尺）。 */
export interface Placement {
  /** 旋轉量，加到既有主軸方位上。 */
  rotation: number;
  /** 沿既有主軸的平移，正值往東。 */
  along: number;
  /** 垂直既有主軸的平移，正值往北。 */
  lateral: number;
}

/** 西側接軌方式：由接軌點與月台側切線點產生西段線形。 */
export interface WestApproach {
  /** 既有高鐵股道的接軌對象：甲接北線、乙接南線。 */
  tieInIds: Record<string, { west: string; east: string }>;
  /** 月台西端往西的切線段長度（公尺）。 */
  tangent: number;
  /** 分岔點（沿既有第一月台主軸，公尺）；省略時四條股道各自接軌（方案 C）。 */
  splitAlong?: number;
  /**
   * 西段線形，回傳由接軌點到切線起點的折線（由西往東）。
   * `tieBearing` 與 `startBearing` 皆為往東行進的方位（度）。
   */
  build(
    tie: Local,
    tieBearing: number,
    start: Local,
    startBearing: number,
    name: string,
    side: "北" | "南" | "幹",
  ): Local[];
  /** 寫入股道 sourceNote 的西段說明。 */
  note: string;
}

export interface ScenarioConfig {
  id: Scenario["id"];
  label: string;
  placement: Placement;
  /** 改建區間的東西界（局部座標 x，公尺）。 */
  rebuildZone: { westX: number; eastX: number };
  /**
   * 東側反向曲線的標稱半徑上限（公尺）；四股道共用同一半徑，自此每 1 公尺往下試到 {@link MIN_RADIUS}，
   * 取第一個四股道皆能相切銜接的解。
   */
  eastRadius: number;
  west: WestApproach;
  /** 西側改建段的既有高鐵股道 id（界線以東的部分標為改建）。 */
  rebuiltWest: string[];
  /** 寫入改建段 sourceNote 的說明。 */
  hsrNote: string;
  /**
   * 機場捷運尾軌的縱斷面：`underpass` 以 {@link MIN_TRACK_SEPARATION} 的股道垂直淨距自所跨越的捷運正線下方通過
   * （可穿越其站體基礎），坡度上限 {@link A1_MAX_GRADE}，止於中山北路一段西側；
   * `stub` 維持股道端點的軌道面（坡度 0），止於所遇第一個捷運構造物前。
   */
  a1Tail: "underpass" | "stub";
}

// ── 固定參數 ────────────────────────────────────────────
/** 新建月台長度（公尺）：16 節車廂全長。 */
export const NEW_PLATFORM_LENGTH = 410;
/**
 * 新建月台中心線相對既有第一月台中心線的南移量（公尺）。
 * 正本 B′ 量得 52.5／70.4（中心間距 17.9 公尺），但該疊圖的月台畫得比實際窄；
 * 本專案保留 12 公尺島式月台（既有月台過窄正是改建動機之一），
 * 中心間距因此放寬為 21.0 公尺，外側股道較正本各外擴約 1.5 公尺。
 */
export const PLATFORM_OFFSETS: Record<string, number> = { 甲: 51.0, 乙: 72.0 };
/** K 區地下街輪廓；新月台東端的基準位置對齊其東端（正本 B′ 的配置）。 */
const MALL_K_ID = "way/450732441";
/**
 * 相切連接器為配合接軌點而縮小半徑時的下限（公尺）；低於此值即視為線形不可行。
 * 東西兩側的相切銜接共用；方案 B 西側的實際最小半徑為 93。
 */
export const MIN_RADIUS = 90;
/** 新建工程平面包絡：外側股道中心各外放的距離（公尺，隧道壁厚與淨空）。 */
export const WORKS_CLEARANCE = 4.5;
/** 受開挖侵入檢查的站前地下街 OSM 圖徵。 */
const MALL_Z_IDS = [
  "way/328691510",
  "way/1174010640",
  "way/1174010641",
  "way/1174010642",
  "way/1174010643",
  "way/1174010644",
];

/** 舊高鐵股道改作臺鐵的區段（沿既有第一月台主軸，公尺）。 */
const TRA_REUSE: Record<string, { from: number; to: number }> = {
  "way/13991375": { from: -322, to: Infinity }, // 西側北線：W1 落點至月台
  "way/323105864": { from: -268, to: Infinity }, // 西側南線：W2 落點至月台
  "way/381111230": { from: -Infinity, to: 345 }, // 東側北線：月台至 E2 起點
  "way/593866771": { from: -Infinity, to: 272 }, // 東側南線：月台至 E1 起點
};

/** 臺鐵聯絡線與渡線：自 from 股道的沿主軸位置直線接到 to 股道。 */
const TRA_LINKS = [
  {
    key: "W1",
    name: "臺鐵聯絡線 西 1（通過線—北線）",
    from: { id: "way/542501100", along: -368 },
    to: { id: "way/13991375", along: -322 },
  },
  {
    key: "W2",
    name: "臺鐵渡線 西 2（北線—南線）",
    from: { id: "way/13991375", along: -312 },
    to: { id: "way/323105864", along: -268 },
  },
  {
    key: "E1",
    name: "臺鐵渡線 東 1（南線—北線）",
    from: { id: "way/593866771", along: 272 },
    to: { id: "way/381111230", along: 318 },
  },
  {
    key: "E2",
    name: "臺鐵聯絡線 東 2（北線—通過線）",
    from: { id: "way/381111230", along: 345 },
    to: { id: "way/542501100", along: 395 },
  },
  {
    key: "E3",
    name: "臺鐵渡線 東 3（東正線—西正線）",
    from: { id: "way/615600482", along: 480 },
    to: { id: "way/194118023", along: 530 },
  },
] as const;

const TRA_THROAT_NOTE =
  "臺鐵 1989 年地下化時以單一雙軌隧道銜接 4 座島式月台與通過線；喉道依 OSM 既有股道重建，聯絡線位置與道岔型式為推估。";

const SOURCE_NOTE =
  "幾何依研究小組《臺北車站方案 B′ 軌道配置構想》疊圖量得；該疊圖的股道為圖上幾何曲線，未對照高鐵設計規範。";

// ── 機場捷運 A1 直通化 ──────────────────────────────────
/** 兩組喉道：各組的正線與外側側線匯入同一條尾軌，尾軌直線段的側向位置（沿第一月台主軸，公尺）。 */
const A1_THROAT = [
  { side: "北", lateral: 106.7, main: "metro/a/north", siding: "way/619251069" },
  { side: "南", lateral: 101.0, main: "metro/a/south", siding: "way/619251068" },
] as const;
/** 尾軌直線段起點（沿主軸，公尺）：四條股道的連接曲線止於此。 */
const A1_TAIL_TIE = -50;
/** 下穿時的尾軌東端（沿主軸，公尺）：中山北路一段西側車道（`way/336634148`，沿主軸 309⋯313）。 */
const A1_TAIL_END = 309;
/** 機場捷運的設計最大坡度 3%（朱旭〈回顧『機場捷運』〉，土木水利 44 卷 2 期，2017）；尾軌與側線延伸的坡度上限。 */
export const A1_MAX_GRADE = 0.03;
/** 四條股道共用的喉道半徑：標稱上限與下限（公尺）。 */
const A1_TAIL_RADIUS = 200;
const A1_TAIL_MIN_RADIUS = 195;
/** 喉道緩和曲線長度（公尺）：捷運低速段，不沿用 0.5R 的高鐵慣例。 */
const A1_TAIL_SPIRAL = 20;
/** 側線延伸與尾軌重合的判定距離（公尺），即側線延伸的終點（道岔處）。 */
const A1_MERGE_TOLERANCE = 0.05;
/**
 * 側線道岔的水平區段長度（公尺）：自道岔尖端（側線延伸與尾軌重合處）往西，尾軌與側線延伸在此區段內皆維持水平。
 * 40 公尺處兩線中心距 2.7–3.3 公尺，涵蓋 9–10 號道岔至轍叉後端；推估值。
 */
export const A1_TURNOUT_LENGTH = 40;
/**
 * 兩條尾軌之間的渡線：機場捷運靠右行駛，渡線依東行方向由右往左，自南尾軌接到北尾軌，沿主軸長 51 公尺（橫移比約 1:8.9）。
 * 渡線須設於水平段：西端取沿主軸 0，或兩條尾軌皆已水平、且離開所跨越構造物 {@link WORKS_CLEARANCE} 之處，取較東者。
 */
const A1_CROSSOVER_FROM = 0;
const A1_CROSSOVER_SPAN = 51;
/** 尾軌縱斷面取樣間距（公尺），用於找出所跨越的捷運構造物與正線。 */
const A1_PROFILE_STEP = 0.5;

function a1Note(radius: number): string {
  return (
    "機場捷運台北車站改為直通式，兩座島式月台的四條股道皆可東行：" +
    "北側正線與北側外側側線匯入北尾軌、南側正線與南側外側側線匯入南尾軌，" +
    `四條股道共用喉道半徑 ${radius} 公尺、緩和曲線 ${A1_TAIL_SPIRAL} 公尺，尾軌直線段自沿主軸 −${-A1_TAIL_TIE} 起；` +
    "起點位置、方位與軌道面取自現況路網的股道端點；道岔型式與號誌未檢核。"
  );
}

const PLATFORM1_ID = "way/584167409";

const underground = undergroundJson as unknown as OsmDataset;
let cachedAxis: PolygonAxis | undefined;

/**
 * 既有第一月台的主軸；方案幾何一律以此為基準座標系。
 * 取 OSM 原始輪廓：場景中的月台已依相鄰軌道重建（`structures/platforms.ts`），
 * 基準座標系不隨之移動，方案幾何才不受月台重建影響。
 */
export function platform1Axis(): PolygonAxis {
  if (cachedAxis) return cachedAxis;
  const polygon = underground.features.find((f) => f.id === PLATFORM1_ID)?.polygon;
  if (!polygon) throw new Error(`找不到既有第一月台 ${PLATFORM1_ID} 的輪廓`);
  cachedAxis = polygonAxis(polygon);
  return cachedAxis;
}

/** 把一組點換算到第一月台主軸座標系（x 沿主軸往東、y 往北為正）。 */
function toAxisFrame(points: Local[]): Local[] {
  const axis = platform1Axis();
  return points.map((p) => {
    const { along, lateral } = decompose(axis.center, axis.bearing, p);
    return [along, lateral] as Local;
  });
}

/** 自第一月台主軸座標系換算回局部公尺座標。 */
function fromAxisFrame(point: Local): Local {
  const axis = platform1Axis();
  return advance(advance(axis.center, axis.bearing, point[0]), axis.bearing + 90, point[1]);
}

/** 自沿主軸位置與側向偏移取局部座標。 */
export function axisPoint(along: number, lateral: number): Local {
  return fromAxisFrame([along, lateral]);
}

/** 既有股道沿第一月台主軸 `along` 公尺處的位置。 */
export function pointAtAlong(id: string, along: number): Local {
  const line = baselineById(id)?.geometry.polyline;
  if (!line) throw new Error(`找不到既有股道 ${id}`);
  const cut = polylineCrossingAtX(toAxisFrame(line), along);
  if (!cut) throw new Error(`股道 ${id} 未通過沿主軸 ${along} 公尺處`);
  return fromAxisFrame(cut);
}

/** 以垂直第一月台主軸的界線切開折線，回傳界線兩側（由西往東）。 */
export function splitAtAlong(line: Local[], along: number): { before: Local[]; after: Local[] } {
  const { west, east } = splitPolylineAtX(toAxisFrame(line), along);
  return { before: west.map(fromAxisFrame), after: east.map(fromAxisFrame) };
}

/** 新月台東端的基準位置：既有第一月台主軸上、與 K 區地下街東端等距之處（正本量得 +50.6 公尺）。 */
function newPlatformEast(): Local {
  const axis = platform1Axis();
  const polygon = baselineById(MALL_K_ID)?.geometry.polygon;
  if (!polygon) throw new Error(`找不到 K 區地下街 ${MALL_K_ID} 的輪廓`);
  const along = Math.max(...polygon.map((p) => decompose(axis.center, axis.bearing, p).along));
  return advance(axis.center, axis.bearing, along);
}

/**
 * 以既有第一月台主軸為基準，取得新建月台的中心線（由西往東）。
 * 兩座月台視為一組：先把基準中點依 `placement` 平移，再繞該點旋轉，
 * 各月台自旋轉後的主軸往南偏移 `southOffset`。
 */
function newPlatformCentre(placement: Placement, southOffset: number): Local[] {
  const axis = platform1Axis();
  const mid = advance(newPlatformEast(), axis.bearing, -NEW_PLATFORM_LENGTH / 2);
  const bearing = axis.bearing + placement.rotation;
  const moved = advance(
    advance(mid, axis.bearing, placement.along),
    axis.bearing + 90,
    placement.lateral,
  );
  // 往東行進時右側即為南側
  const centre = advance(moved, bearing - 90, southOffset);
  return [
    advance(centre, bearing, -NEW_PLATFORM_LENGTH / 2),
    advance(centre, bearing, NEW_PLATFORM_LENGTH / 2),
  ];
}

/** 既有高鐵股道在改建界線上的接軌點。 */
function tieIn(id: string, limitX: number): Local {
  const line = baselineById(id)?.geometry.polyline;
  if (!line) throw new Error(`找不到既有高鐵股道 ${id}`);
  const point = polylineCrossingAtX(line, limitX);
  if (!point) throw new Error(`既有高鐵股道 ${id} 未通過 x=${limitX} 的改建界線`);
  return point;
}

/** 既有高鐵股道在改建界線上的方位（度，往東為正）。 */
function tieInBearing(id: string, limitX: number): number {
  const line = baselineById(id)?.geometry.polyline;
  if (!line) throw new Error(`找不到既有高鐵股道 ${id}`);
  const bearing = polylineBearingAtX(line, limitX);
  if (bearing === null) throw new Error(`既有高鐵股道 ${id} 未通過 x=${limitX} 的改建界線`);
  return bearing;
}

function platformFeature(id: Scenario["id"], name: string, centre: Local[]): Feature {
  return {
    id: `${id}/platform/${name}`,
    kind: "platform",
    name: `高鐵新月台 ${name}`,
    level: "B2",
    structure: "tra-hsr-station",
    layer: "platform",
    geometry: { polygon: corridorPolygon(centre, PLATFORM_WIDTH) },
    base: railLevelOf("tra-hsr-station", "B2"),
    height: PLATFORM_RISE,
    confidence: "estimated",
    sourceNote: `${SOURCE_NOTE} 月台長 ${NEW_PLATFORM_LENGTH} 公尺、寬 ${PLATFORM_WIDTH} 公尺。`,
    status: "added",
  };
}

/**
 * 共用半徑的相切連接器：自 `maxRadius` 起每 1 公尺往下試到 `minRadius`，取第一個每一端皆有解的半徑。
 * 各端由 `end`（行進方位 `endBearing`）接到 `tie`（行進方位 `tieBearing`）；同半徑時共用同一 `tie` 的
 * 各端自 `tie` 起共線，到位移較小者反向處才分岔。回傳的折線由 `end` 到 `tie`；無解回傳 null。
 * {@link tangentConnector} 容許曲線末端越過端點至多 0.5 公尺再以直線折返端點；
 * 此處視越過為無解，連接器必自端點起朝行進方向前進。
 */
function commonRadiusConnectors(
  ends: { key: string; end: Local; endBearing: number; tie: Local; tieBearing: number }[],
  maxRadius: number,
  minRadius: number,
  spiral?: number,
): { radius: number; lines: Map<string, Local[]> } | null {
  for (let radius = maxRadius; radius >= minRadius; radius -= 1) {
    const lines = new Map<string, Local[]>();
    for (const end of ends) {
      // 自接軌點往回算到端點的切線，點序與兩端方位皆須反轉
      const joined = tangentConnector(
        end.tie,
        end.tieBearing + 180,
        end.end,
        end.endBearing + 180,
        radius,
        radius,
        spiral,
      );
      if (!joined) break;
      const line = joined.points.slice().reverse();
      const [x, y] = [line[1][0] - line[0][0], line[1][1] - line[0][1]];
      const rad = (end.endBearing * Math.PI) / 180;
      if (x * Math.cos(rad) + y * Math.sin(rad) < 0) break;
      lines.set(end.key, line);
    }
    if (lines.size === ends.length) return { radius, lines };
  }
  return null;
}

/**
 * 東側四股道的相切連接器，四股道共用同一半徑（{@link commonRadiusConnectors}，`config.eastRadius` 到
 * {@link MIN_RADIUS}）。各股道若各取各的最大半徑，自同一接軌點出發的兩條曲線形狀不同，
 * 會在喉道內彼此交叉；同半徑時同一月台的兩股道自接軌點起共線，
 * 到位移較小的一股反向處才分岔，由北而南的順序全程不變。
 */
function eastConnection(
  config: ScenarioConfig,
  tracks: { key: string; name: string; line: Local[] }[],
): { radius: number; lines: Map<string, Local[]> } {
  const zone = config.rebuildZone;
  const ends = tracks.map(({ key, name, line }) => {
    const west = line[0];
    const east = line[line.length - 1];
    const id = config.west.tieInIds[name].east;
    return {
      key,
      end: east,
      endBearing: (Math.atan2(east[1] - west[1], east[0] - west[0]) * 180) / Math.PI,
      tie: tieIn(id, zone.eastX),
      tieBearing: tieInBearing(id, zone.eastX),
    };
  });
  const solved = commonRadiusConnectors(ends, config.eastRadius, MIN_RADIUS);
  if (solved) return solved;
  throw new Error(
    `${config.label} 東側四股道無法以不低於 ${MIN_RADIUS} 公尺的同一半徑相切接回既有線形`,
  );
}

function trackFeature(
  config: ScenarioConfig,
  name: string,
  side: "北" | "南",
  trackLine: Local[],
  west: Local[],
  east: { radius: number; line: Local[] },
): Feature {
  const zone = config.rebuildZone;
  const line: Local[] = [...west, ...trackLine.slice(1, -1), ...east.line];

  return {
    id: `${config.id}/track/${name}-${side}`,
    kind: "track-hsr",
    line: "hsr",
    name: `高鐵新建股道（月台 ${name} ${side}側）`,
    level: "B2",
    structure: "tra-hsr-station",
    layer: "track",
    geometry: { polyline: line },
    base: railLevelOf("tra-hsr-station", "B2"),
    height: 0.3,
    width: 3,
    confidence: "estimated",
    sourceNote:
      `${SOURCE_NOTE} 東側沿月台切線延伸後以反向曲線與既有高鐵股道相切銜接` +
      `（接軌點 x ${zone.eastX}），四股道東側半徑一律 ${east.radius} 公尺；${config.west.note}`,
    status: "added",
  };
}

/** 西側雙線幹線：自既有喉道接軌點到分岔點，一條幹線供一座月台的兩條股道共用。 */
function trunkFeature(config: ScenarioConfig, name: string, line: Local[]): Feature {
  return {
    id: `${config.id}/trunk/${name}`,
    kind: "track-hsr",
    line: "hsr",
    name: `高鐵新建幹線（往月台 ${name}）`,
    level: "B2",
    structure: "tra-hsr-station",
    layer: "track",
    geometry: { polyline: line },
    base: railLevelOf("tra-hsr-station", "B2"),
    height: 0.3,
    width: 3,
    confidence: "estimated",
    sourceNote: `${SOURCE_NOTE} 西側維持既有雙線形態，於沿主軸 ${config.west.splitAlong} 公尺（三井倉庫西側）分岔為四條股道；${config.west.note}`,
    status: "added",
  };
}

/** 機場捷運 A1 股道的東端：位置、東行方位與軌道面高程，皆取自現況路網。 */
function a1TrackEnd(id: string): { end: Local; bearing: number; elevation: number } {
  const feature = baselineById(id);
  const existing = feature?.geometry.polyline;
  if (!feature || !existing) throw new Error(`找不到機場捷運 A1 股道 ${id}`);
  const axis = platform1Axis();
  const band = existing.map((p) => decompose(axis.center, axis.bearing, p).along);
  const last = band.indexOf(Math.max(...band));
  const end = existing[last];
  // 相鄰頂點必在東端以西，`prev → end` 即為東行方向
  const prev = existing[last === 0 ? 1 : last - 1];
  return {
    end,
    bearing: (Math.atan2(end[1] - prev[1], end[0] - prev[0]) * 180) / Math.PI,
    elevation: vertexElevations(feature)[last],
  };
}

/** 兩折線的外包矩形是否重疊。 */
function boundsOverlap(a: Local[], b: Local[]): boolean {
  const box = (line: Local[]) => {
    const xs = line.map((p) => p[0]);
    const ys = line.map((p) => p[1]);
    return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  };
  const [ax0, ax1, ay0, ay1] = box(a);
  const [bx0, bx1, by0, by1] = box(b);
  return ax0 <= bx1 && bx0 <= ax1 && ay0 <= by1 && by0 <= ay1;
}

/**
 * 尾軌縱斷面：沿平面線形找出所跨越的捷運構造物與正線（機場捷運除外）。
 *
 * - `underpass`：自股道端點以同一坡度下降，於側線道岔區段（尖端往西 {@link A1_TURNOUT_LENGTH}）維持水平，
 *   再下降到第一條所跨越正線的軌道面減 {@link MIN_TRACK_SEPARATION}，其後水平；
 *   站體基礎可穿越，所跨越的構造物只用來界定渡線位置。坡度超過 {@link A1_MAX_GRADE} 即擲出錯誤。
 * - `stub`：全段維持股道端點的軌道面，止於第一個所跨越構造物前 {@link WORKS_CLEARANCE}（端牆與淨空）。
 *
 * `zone` 為道岔區段的高程；`clearArc` 為尾軌自此已水平、且離開所有所跨越構造物 {@link WORKS_CLEARANCE} 的弧長。
 */
function tailProfile(
  side: string,
  plan: Local[],
  start: number,
  mode: ScenarioConfig["a1Tail"],
  mergeArc: number,
): {
  points: Local[];
  elevations: number[];
  target: number;
  grade: number;
  zone: number;
  clearArc: number;
  ids: string[];
} {
  const samples = resample(plan, A1_PROFILE_STEP);
  const sampleArcs = arcLengths(samples);
  const total = sampleArcs[sampleArcs.length - 1];
  /**
   * 取樣點與量體的關係：第一個落在量體內者（`at`），與第一個、最後一個落在量體內或距其邊界不足
   * {@link WORKS_CLEARANCE} 者（`near`、`far`）；未落入量體則為 null。
   */
  const crossing = (outline: Local[], inside: (p: Local) => boolean) => {
    if (!boundsOverlap(samples, outline)) return null;
    let at = -1;
    let near = -1;
    let far = -1;
    for (let i = 0; i < samples.length; i++) {
      const within = inside(samples[i]);
      if (within && at < 0) at = i;
      if (within || nearestOnPolyline(samples[i], outline).distance < WORKS_CLEARANCE) {
        if (near < 0) near = i;
        far = i;
      }
    }
    return at < 0 ? null : { at, near, far };
  };

  /** 所跨越的捷運構造物（公告圖箱涵、站體樓板與大廳）：進入、接近與離開處的弧長。 */
  const structures: { id: string; arc: number; near: number; far: number }[] = [];
  /** 所跨越的捷運正線：另附下穿所需的軌道面。 */
  const tracks: { id: string; arc: number; near: number; far: number; rail: number }[] = [];
  for (const feature of buildBaseline()) {
    if (feature.line === undefined || feature.line === "a") continue;
    const polygon = feature.geometry.polygon;
    if (feature.layer === "metro" && feature.structure !== undefined && polygon) {
      const hit = crossing([...polygon, polygon[0]], (p) => pointInPolygon(p, polygon));
      if (!hit) continue;
      structures.push({ id: feature.id, arc: sampleArcs[hit.at], near: sampleArcs[hit.near], far: sampleArcs[hit.far] });
      continue;
    }
    const line = feature.geometry.polyline;
    if (feature.kind !== "track-metro" || feature.trackRole !== "main" || !line) continue;
    const hit = crossing(line, (p) => nearestOnPolyline(p, line).distance <= A1_PROFILE_STEP);
    if (!hit) continue;
    const crossed = elevationAt(feature)(nearestArc(line, arcLengths(line), samples[hit.at]).arc);
    tracks.push({
      id: feature.id,
      arc: sampleArcs[hit.at],
      near: sampleArcs[hit.near],
      far: sampleArcs[hit.far],
      rail: crossed - MIN_TRACK_SEPARATION,
    });
  }
  const all = [...structures, ...tracks];
  const flat = (clearArc: number) => ({
    ...profiled(plan, [
      [0, start],
      [total, start],
    ]),
    target: start,
    grade: 0,
    zone: start,
    clearArc,
    ids: [],
  });

  if (mode === "stub") {
    if (all.length === 0) return flat(0);
    // 止於第一個距構造物不足淨距的取樣點之前
    const first = Math.min(...all.map((c) => c.near));
    const ids = all.filter((c) => c.near === first).map((c) => c.id);
    const endArc = first - A1_PROFILE_STEP;
    if (endArc <= 0) throw new Error(`機場捷運尾軌（${side}）自股道端點即接近 ${ids.join("、")}，無處設置尾軌`);
    if (endArc <= mergeArc) throw new Error(`機場捷運尾軌（${side}）止於側線匯入處以西`);
    const arcs = arcLengths(plan);
    const points = [...plan.filter((_, i) => arcs[i] < endArc), pointAtArc(plan, arcs, endArc)];
    return { points, elevations: points.map(() => start), target: start, grade: 0, zone: start, clearArc: 0, ids };
  }

  // 下穿時只有需低於股道端點的正線受限；構造物（含站體基礎）可穿越
  const binding = tracks.filter((c) => c.rail < start);
  const clearArc = all.length ? Math.max(...all.map((c) => c.far)) : 0;
  if (binding.length === 0) return flat(clearArc);

  const target = Math.min(...binding.map((c) => c.rail));
  const crossArc = Math.min(...binding.map((c) => c.arc));
  const ids = binding.map((c) => c.id);
  const zoneFrom = mergeArc - A1_TURNOUT_LENGTH;
  if (zoneFrom <= 0) throw new Error(`機場捷運尾軌（${side}）的側線道岔區段超出股道端點`);
  if (crossArc <= mergeArc) throw new Error(`機場捷運尾軌（${side}）的側線道岔位於下穿處以東`);
  const grade = (start - target) / (crossArc - A1_TURNOUT_LENGTH);
  if (grade > A1_MAX_GRADE + 1e-9) {
    throw new Error(
      `機場捷運尾軌（${side}）須以 ${(grade * 100).toFixed(2)}% 下穿 ${ids.join("、")}，超過 ${A1_MAX_GRADE * 100}%`,
    );
  }
  const zone = start - grade * zoneFrom;
  const descended = profiled(plan, [
    [0, start],
    [zoneFrom, zone],
    [mergeArc, zone],
    [crossArc, target],
    [total, target],
  ]);
  return { ...descended, target, grade, zone, clearArc, ids };
}

/**
 * 機場捷運 A1 改為直通式車站：兩座島式月台的四條股道皆可東行，
 * 各側正線與外側側線以共用半徑的喉道匯入同一條尾軌。
 * 起點位置、方位與軌道面取自現況路網的股道端點；尾軌的縱斷面與東端依 `config.a1Tail`
 * 推得（{@link tailProfile}）：下穿時以 {@link MIN_TRACK_SEPARATION} 的股道垂直淨距自淡水信義線正線下方通過，
 * 止於中山北路一段西側，側線道岔與渡線皆設於水平段；或維持坡度 0 止於其車站箱涵前。
 */
function airportTailFeatures(config: ScenarioConfig): Feature[] {
  const axis = platform1Axis();
  const ends = new Map(
    A1_THROAT.flatMap((group) => [group.main, group.siding]).map((id) => [id, a1TrackEnd(id)]),
  );
  const throat = commonRadiusConnectors(
    A1_THROAT.flatMap((group) =>
      [group.main, group.siding].map((id) => {
        const { end, bearing } = ends.get(id)!;
        return {
          key: id,
          end,
          endBearing: bearing,
          tie: axisPoint(A1_TAIL_TIE, group.lateral),
          tieBearing: axis.bearing,
        };
      }),
    ),
    A1_TAIL_RADIUS,
    A1_TAIL_MIN_RADIUS,
    A1_TAIL_SPIRAL,
  );
  if (!throat) {
    throw new Error(`機場捷運 A1 四條股道無法以不低於 ${A1_TAIL_MIN_RADIUS} 公尺的同一半徑接到尾軌`);
  }
  const note = a1Note(throat.radius);
  const common = {
    kind: "track-metro",
    line: "a",
    structure: "airport-mrt-a1",
    layer: "metro",
    height: TRACK_BAND_THICKNESS,
    width: TRACK_BAND_WIDTH,
    confidence: "estimated",
    status: "added",
  } as const;

  const features: Feature[] = [];
  const tails = new Map<string, Feature>();
  const clearAlong = new Map<string, number>();
  const tailEndAlong = new Map<string, number>();
  for (const group of A1_THROAT) {
    const plan = [...throat.lines.get(group.main)!, axisPoint(A1_TAIL_END, group.lateral)];
    // 側線延伸：沿共用半徑的連接曲線到與尾軌重合處（道岔尖端）為止
    const full = throat.lines.get(group.siding)!;
    const merge = full.findIndex((p) => nearestOnPolyline(p, plan).distance <= A1_MERGE_TOLERANCE);
    if (merge < 0) throw new Error(`機場捷運側線 ${group.siding} 的延伸未匯入尾軌（${group.side}）`);
    const branchPlan = full.slice(0, merge + 1);
    const mergeArc = nearestArc(plan, arcLengths(plan), branchPlan[merge]).arc;
    const profile = tailProfile(group.side, plan, ends.get(group.main)!.elevation, config.a1Tail, mergeArc);
    const tailId = `${config.id}/a1/tail/${group.side}`;
    const profileArcs = arcLengths(profile.points);
    const endAlong = decompose(axis.center, axis.bearing, profile.points[profile.points.length - 1]).along;
    const mergeAlong = decompose(axis.center, axis.bearing, branchPlan[merge]).along;
    clearAlong.set(
      group.side,
      decompose(axis.center, axis.bearing, pointAtArc(profile.points, profileArcs, profile.clearArc)).along,
    );
    tailEndAlong.set(group.side, endAlong);
    const profileNote =
      profile.ids.length === 0
        ? "縱斷面維持股道端點的軌道面，坡度 0。"
        : config.a1Tail === "stub"
          ? `縱斷面維持股道端點的軌道面（坡度 0），止於 ${profile.ids.join("、")} 前 ${WORKS_CLEARANCE} 公尺（沿主軸 ${endAlong.toFixed(1)}）。`
          : `縱斷面自股道端點以 ${(profile.grade * 100).toFixed(2)}% 下降，` +
            `於側線道岔（尖端沿主軸 ${mergeAlong.toFixed(1)}，往西 ${A1_TURNOUT_LENGTH} 公尺）維持水平 EL ${profile.zone.toFixed(3)}，` +
            `再以同坡度下降至 EL ${profile.target.toFixed(3)}，與 ${profile.ids.join("、")} 保持 ${MIN_TRACK_SEPARATION} 公尺的股道垂直淨距自其下方通過` +
            "（穿越淡水信義線站體基礎），其後維持水平至中山北路一段西側。";
    const tail: Feature = {
      ...common,
      id: tailId,
      name: `機場捷運尾軌（${group.side}）`,
      level: levelLabelFor(Math.min(...profile.elevations)),
      geometry: { polyline: profile.points },
      elevations: profile.elevations,
      base: profile.elevations[0],
      sourceNote: `${note} ${profileNote}`,
      trackRole: "main",
      joins: [group.main, null],
    };
    tails.set(group.side, tail);
    features.push(tail);

    // 側線延伸自股道端點下降，最後 A1_TURNOUT_LENGTH 公尺與尾軌的道岔區段同高
    const from = ends.get(group.siding)!.elevation;
    const to = elevationAt(tail)(nearestArc(profile.points, profileArcs, branchPlan[merge]).arc);
    const length = arcLengths(branchPlan)[merge];
    if (length <= A1_TURNOUT_LENGTH) throw new Error(`機場捷運側線延伸（${group.side}）短於道岔區段`);
    const branch = profiled(branchPlan, [
      [0, from],
      [length - A1_TURNOUT_LENGTH, to],
      [length, to],
    ]);
    const limit = config.a1Tail === "underpass" ? A1_MAX_GRADE : 0;
    const branchArcs = arcLengths(branch.points);
    for (let i = 1; i < branch.points.length; i++) {
      const rise = Math.abs(branch.elevations[i] - branch.elevations[i - 1]);
      if (rise / (branchArcs[i] - branchArcs[i - 1]) > limit + 1e-9) {
        throw new Error(`機場捷運側線延伸（${group.side}）坡度超過 ${limit * 100}%`);
      }
    }
    features.push({
      ...common,
      id: `${config.id}/a1/branch/${group.side}`,
      name: `機場捷運側線東延（${group.side}）`,
      level: levelLabelFor(Math.min(...branch.elevations)),
      geometry: { polyline: branch.points },
      elevations: branch.elevations,
      base: branch.elevations[0],
      sourceNote: note,
      trackRole: "siding",
      joins: [group.siding, tailId],
    });
  }

  const north = tails.get("北")!;
  const south = tails.get("南")!;
  const crossoverFrom = Math.max(A1_CROSSOVER_FROM, Math.ceil(Math.max(...clearAlong.values())));
  const crossoverTo = crossoverFrom + A1_CROSSOVER_SPAN;
  if (crossoverTo >= Math.min(...tailEndAlong.values())) {
    throw new Error(`機場捷運尾軌渡線（沿主軸 ${crossoverFrom}–${crossoverTo}）超出尾軌東端`);
  }
  const crossover: Local[] = [
    axisPoint(crossoverFrom, A1_THROAT[1].lateral),
    axisPoint(crossoverTo, A1_THROAT[0].lateral),
  ];
  const footElevation = (tail: Feature, p: Local): number => {
    const line = tail.geometry.polyline!;
    return elevationAt(tail)(nearestArc(line, arcLengths(line), p).arc);
  };
  const linkElevations = [footElevation(south, crossover[0]), footElevation(north, crossover[1])];
  features.push({
    ...common,
    id: `${config.id}/a1/link/X1`,
    name: "機場捷運尾軌渡線",
    level: levelLabelFor(Math.min(...linkElevations)),
    geometry: { polyline: crossover },
    elevations: linkElevations,
    base: linkElevations[0],
    sourceNote: note,
    trackRole: "crossover",
    joins: [south.id, north.id],
  });

  return features;
}

function buildAdded(config: ScenarioConfig): Feature[] {
  const platforms = Object.entries(PLATFORM_OFFSETS).map(([name, offset]) => ({
    name,
    centre: newPlatformCentre(config.placement, offset),
  }));
  const tracks = platforms.flatMap(({ name, centre }) =>
    (["北", "南"] as const).map((side) => ({
      key: `${name}-${side}`,
      name,
      side,
      line: offsetPolyline(centre, side === "北" ? TRACK_OFFSET : -TRACK_OFFSET),
    })),
  );
  const east = eastConnection(config, tracks);

  const features: Feature[] = [];
  for (const { name, centre } of platforms) {
    features.push(platformFeature(config.id, name, centre));

    const tie = config.west.tieInIds[name];
    const zone = config.rebuildZone;
    const bearing =
      (Math.atan2(centre[1][1] - centre[0][1], centre[1][0] - centre[0][0]) * 180) / Math.PI;
    const own = tracks.filter((track) => track.name === name);
    const west = new Map<string, Local[]>();

    if (config.west.splitAlong === undefined) {
      for (const track of own) {
        west.set(
          track.key,
          config.west.build(
            tieIn(tie.west, zone.westX),
            tieInBearing(tie.west, zone.westX),
            advance(track.line[0], bearing + 180, config.west.tangent),
            bearing,
            name,
            track.side,
          ),
        );
      }
    } else {
      // 西側維持既有雙線形態：幹線接月台中心線的切線起點，分岔點之後才漸移為兩條股道
      const spine = config.west.build(
        tieIn(tie.west, zone.westX),
        tieInBearing(tie.west, zone.westX),
        advance(centre[0], bearing + 180, config.west.tangent),
        bearing,
        name,
        "幹",
      );
      const { before: trunk, after: fan } = splitAtAlong(spine, config.west.splitAlong);
      features.push(trunkFeature(config, name, trunk));
      const taper = polylineLength(fan);
      for (const track of own) {
        west.set(
          track.key,
          taperedOffset(fan, 0, taper, track.side === "北" ? TRACK_OFFSET : -TRACK_OFFSET),
        );
      }
    }

    for (const track of own) {
      const line = east.lines.get(track.key);
      if (!line) throw new Error(`找不到新建股道 ${track.key} 的東側連接線`);
      const westPart = west.get(track.key);
      if (!westPart) throw new Error(`找不到新建股道 ${track.key} 的西段線形`);
      features.push(
        trackFeature(config, name, track.side, track.line, westPart, {
          radius: east.radius,
          line,
        }),
      );
    }
  }

  for (const link of TRA_LINKS) {
    features.push({
      id: `${config.id}/tra-link/${link.key}`,
      kind: "track-tra",
      line: "tra",
      name: link.name,
      level: "B2",
      structure: "tra-hsr-station",
      layer: "track",
      geometry: {
        polyline: [
          pointAtAlong(link.from.id, link.from.along),
          pointAtAlong(link.to.id, link.to.along),
        ],
      },
      base: railLevelOf("tra-hsr-station", "B2"),
      height: 0.3,
      width: 3,
      confidence: "estimated",
      sourceNote: TRA_THROAT_NOTE,
      status: "added",
    });
  }

  features.push(...airportTailFeatures(config));
  return features;
}

/** 新建工程開挖範圍的南緣：乙月台南側股道中心往南外放 {@link WORKS_CLEARANCE}。 */
function excavationSouthEdge(id: Scenario["id"], added: Feature[]): Local[] {
  const trackId = `${id}/track/乙-南`;
  const track = added.find((f) => f.id === trackId)?.geometry.polyline;
  if (!track) throw new Error(`找不到新建股道 ${trackId}`);
  return offsetPolyline(track, -WORKS_CLEARANCE);
}

/** 依設定值組出方案；新建量體於第一次取用時才計算。 */
export function buildScenario(config: ScenarioConfig): Scenario {
  let added: Feature[] | null = null;
  const zone = config.rebuildZone;

  return {
    id: config.id,
    label: config.label,
    removed: [
      "way/450732441",
      "way/204711163",
      "way/204616534",
      // 改建區間內的既有高鐵橫渡線：新配置不沿用，一併拆除
      "way/593871105",
      "way/593871117",
      "way/593871135",
      "way/593871144",
      "way/871108522",
    ],
    get added(): Feature[] {
      added ??= buildAdded(config);
      return added;
    },
    repurposed: [
      { id: "way/584167409", note: "第一月台歸還臺鐵" },
      { id: "way/584167411", note: "第二月台歸還臺鐵" },
      { id: "way/593871124", note: "軌距由 1435 mm 改為 1067 mm" },
      { id: "way/593871149", note: "軌距由 1435 mm 改為 1067 mm" },
      { id: "way/615600478", note: "軌距由 1435 mm 改為 1067 mm" },
      { id: "way/615600479", note: "軌距由 1435 mm 改為 1067 mm" },
      { id: "way/615600481", note: "軌距由 1435 mm 改為 1067 mm" },
    ],
    rebuilt: [
      ...config.rebuiltWest.map((id) => ({
        id,
        keep: "west" as const,
        limitX: zone.westX,
        note: config.hsrNote,
        tra: TRA_REUSE[id],
      })),
      ...["way/381111230", "way/593866771"].map((id) => ({
        id,
        keep: "east" as const,
        limitX: zone.eastX,
        note: config.hsrNote,
        tra: TRA_REUSE[id],
      })),
    ],
    get encroached() {
      return [
        {
          ids: MALL_Z_IDS,
          edge: excavationSouthEdge(config.id, this.added),
          note: `${config.label}：落在新建高鐵月台箱涵開挖範圍內的站前地下街出入口，須拆除重建。`,
        },
      ];
    },
  };
}
