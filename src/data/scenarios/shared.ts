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
import { advance, decompose, polygonAxis, type PolygonAxis } from "../../geo/measure.ts";
import {
  corridorPolygon,
  offsetPolyline,
  polylineBearingAtX,
  polylineCrossingAtX,
  splitPolylineAtX,
} from "../../geo/offset.ts";
import type { Local } from "../../geo/project.ts";
import { baselineById } from "../scene.ts";
import { railLevelOf } from "../levels.ts";
import { PLATFORM_RISE, PLATFORM_WIDTH, TRACK_OFFSET, type Feature } from "../schema.ts";

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
    side: "北" | "南",
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

const PLATFORM1_ID = "way/584167409";

let cachedAxis: PolygonAxis | undefined;

/** 既有第一月台的主軸；方案幾何一律以此為基準座標系。 */
export function platform1Axis(): PolygonAxis {
  if (cachedAxis) return cachedAxis;
  const polygon = baselineById(PLATFORM1_ID)?.geometry.polygon;
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
 * 東側四股道的相切連接器，四股道共用同一半徑：自 `config.eastRadius` 起每 1 公尺往下試到
 * {@link MIN_RADIUS}，取第一個四股道皆有解的半徑。各股道若各取各的最大半徑，自同一接軌點出發的
 * 兩條曲線形狀不同，會在喉道內彼此交叉；同半徑時同一月台的兩股道自接軌點起共線，
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
      east,
      bearing: (Math.atan2(east[1] - west[1], east[0] - west[0]) * 180) / Math.PI,
      tie: tieIn(id, zone.eastX),
      tieBearing: tieInBearing(id, zone.eastX),
    };
  });

  for (let radius = config.eastRadius; radius >= MIN_RADIUS; radius -= 1) {
    const lines = new Map<string, Local[]>();
    for (const end of ends) {
      // 自接軌點往西算到月台東端的切線，點序與兩端方位皆須反轉
      const joined = tangentConnector(
        end.tie,
        end.tieBearing + 180,
        end.east,
        end.bearing + 180,
        radius,
        radius,
      );
      if (!joined) break;
      lines.set(end.key, joined.points.slice().reverse());
    }
    if (lines.size === ends.length) return { radius, lines };
  }
  throw new Error(
    `${config.label} 東側四股道無法以不低於 ${MIN_RADIUS} 公尺的同一半徑相切接回既有線形`,
  );
}

function trackFeature(
  config: ScenarioConfig,
  name: string,
  side: "北" | "南",
  trackLine: Local[],
  east: { radius: number; line: Local[] },
): Feature {
  const west = trackLine[0];
  const end = trackLine[trackLine.length - 1];
  const bearing = (Math.atan2(end[1] - west[1], end[0] - west[0]) * 180) / Math.PI;
  const tie = config.west.tieInIds[name];
  const zone = config.rebuildZone;

  const line: Local[] = [
    ...config.west.build(
      tieIn(tie.west, zone.westX),
      tieInBearing(tie.west, zone.westX),
      advance(west, bearing + 180, config.west.tangent),
      bearing,
      name,
      side,
    ),
    ...trackLine.slice(1, -1),
    ...east.line,
  ];

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
    for (const track of tracks) {
      if (track.name !== name) continue;
      const line = east.lines.get(track.key);
      if (!line) throw new Error(`找不到新建股道 ${track.key} 的東側連接線`);
      features.push(
        trackFeature(config, name, track.side, track.line, { radius: east.radius, line }),
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
