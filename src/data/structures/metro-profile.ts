/**
 * 捷運正線的縱斷面：依各站月台層決定本範圍每條捷運正線的軌道面高程。
 *
 * 站表 {@link METRO_STOPS}：每座車站的月台層出自臺北捷運〈車站剖面相關位置圖〉
 * （BL10-SP、BL12/R10-SP、BL13-SP、BL14/O07-SP、R09-SP、R12-SP、G11-SP、G13-SP、G14-SP、G15/O08-SP），
 * 有文獻高程者（臺北車站、北門）取構造物樓層表，其餘取預設樓層表。
 * 西門、中正紀念堂為上下疊式月台，層別由通過的鏈決定。
 *
 * 正線鏈 {@link METRO_CHAINS}：依行進順序首尾相接的 OSM way，每條路線上下行各一條。
 * 各站月台、站體與渡線投影到鏈上的範圍內軌道水平；相鄰兩站以 {@link MAX_GRADE} 連接，
 * 坡段緊鄰較淺的一站，即較深的一站水平延伸到坡底才爬升，與鏈的方向無關。
 * 依據為捷運工程叢書精進版 9《捷運軌道工程實務》表 2-3-1：主線最大縱坡 3%（絕對需求），
 * 特殊短區間經捷運局同意可至 4%，站內水平；本模型只在鏈的 `steep` 指定處用 {@link STEEP_GRADE}。
 *
 * 疊式範圍 {@link inStackedZone}：同一路線上下行兩鏈在平面上重合之處。
 * 公告圖在此只畫一條軌道，深度由本模組切段的 OSM 正線呈現，公告圖軌道讓位；
 * 範圍外的正線由公告圖軌道取代。公告圖軌道、渡線與側線以 {@link profileLineTracks}
 * 投影到同路線最近的鏈上，取得與正線一致的高程。
 */
import undergroundJson from "../osm/underground.json";
import surfaceJson from "../osm/surface.json";
import type { OsmDataset, OsmFeature } from "../osm-types.ts";
import { nearestOnPolyline, pointInPolygon } from "../../geo/measure.ts";
import type { Local } from "../../geo/project.ts";
import { polylineLength, slicePolyline } from "../../geo/offset.ts";
import {
  METRO_LINES,
  STACKED_STATION_NOTE,
  levelLabelFor,
  railLevelOf,
  type MetroLineId,
  type StructureId,
} from "../levels.ts";
import { SOURCE as DORTS_SOURCE, dedupePolylines, dortsStationBoxAt, dortsTrackEnds } from "../dorts.ts";
import { PLATFORM_RISE, type Feature, type LevelId } from "../schema.ts";

const underground = undergroundJson as unknown as OsmDataset;
const surface = surfaceJson as unknown as OsmDataset;

/** 主線最大縱坡：捷運工程叢書精進版 9 表 2-3-1 的絕對需求。 */
export const MAX_GRADE = 0.03;

/** 特殊短區間的縱坡：同表註明經捷運局同意可至 4%；只用於鏈的 `steep` 指定處。 */
export const STEEP_GRADE = 0.035;

/**
 * 平面重合或交會的兩軌之間的最小高差（公尺）：公告圖板南線疊式潛盾半徑 2.88 公尺 × 2 = 5.76，
 * 再加 0.24 公尺；為推估值。
 */
export const MIN_TRACK_SEPARATION = 6.0;

/** 同一路線的兩條鏈在平面上相距小於此值即視為上下疊式（公尺）。 */
const STACKED_PLAN = 3.0;
/** 疊式區間的取樣間距與最短長度（公尺）。 */
const STACKED_STEP = 2;
const STACKED_MIN = 10;

/** 站區範圍的頂點與鏈相距超過此值即不界定該鏈的站區（公尺）：另一條路線的月台與站體。 */
const EXTENT_REACH = 30;

/** 其他軌道投影到鏈上時，頂點距離中位數的上限（公尺）。 */
const PROFILE_REACH = 25;

/**
 * 與鏈相距此值以內、投影落在疊式區間的點屬於疊式範圍（公尺）：
 * 涵蓋公告圖與 OSM 軌道的差距，以及上下行兩鏈的間距。
 */
const ZONE_REACH = 15;

/** 串接正線鏈時視為同一節點的距離（公尺）。 */
const JOIN_TOLERANCE = 1.0;

/** 捷運車站的月台層。 */
export interface MetroStop {
  name: string;
  lines: MetroLineId[];
  /** 月台層；"stacked" 表示上下層由鏈的 `level` 決定（西門、中正紀念堂）。 */
  level: LevelId | "stacked";
  /** 有樓層表者；省略時軌道面取預設樓層表（railLevelOf(undefined, level)）。 */
  structure?: StructureId;
  /** 場景中的月台量體 id，供月台水平測試使用。 */
  platforms: string[];
  /** 投影到鏈上界定站區水平段的 OSM 圖徵（月台面、站體輪廓、渡線）。 */
  extent: string[];
  /** 另以公告圖車站箱涵界定水平段時，箱涵內的一點。 */
  extentBoxesAt?: Local[];
  /** 出處，例如「BL13-SP(24.01)」。 */
  source: string;
}

const SECTION = "臺北捷運〈車站剖面相關位置圖〉";

export const METRO_STOPS: MetroStop[] = [
  {
    name: "龍山寺",
    lines: ["bl"],
    level: "B2",
    platforms: ["way/1054531300"],
    extent: ["way/1054531300"],
    source: `${SECTION}BL10-SP(24.01)`,
  },
  {
    name: "西門",
    lines: ["bl", "g"],
    level: "stacked",
    structure: "metro-station-ximen",
    platforms: ["way/877532225", "ximen/platform/B3"],
    extent: ["way/877532225", "relation/16748280"],
    source: STACKED_STATION_NOTE,
  },
  {
    name: "臺北車站（板南線）",
    lines: ["bl"],
    level: "B3",
    structure: "metro-station",
    platforms: ["way/741259904"],
    extent: ["way/741259904"],
    source: `${SECTION}BL12/R10-SP(26.05)`,
  },
  {
    name: "善導寺",
    lines: ["bl"],
    level: "B2",
    platforms: ["way/877532236"],
    extent: ["way/877532236"],
    source: `${SECTION}BL13-SP(24.01)`,
  },
  {
    name: "忠孝新生（板南線）",
    lines: ["bl"],
    level: "B2",
    platforms: ["way/772602546"],
    extent: ["way/772602546"],
    source: `${SECTION}BL14/O07-SP(24.01)`,
  },
  {
    name: "忠孝新生（中和新蘆線）",
    lines: ["o"],
    level: "B3",
    platforms: ["way/772602545"],
    extent: ["way/772602545"],
    source: `${SECTION}BL14/O07-SP(24.01)`,
  },
  {
    name: "中正紀念堂",
    lines: ["r", "g"],
    level: "stacked",
    structure: "metro-station-cks",
    platforms: ["way/194618311", "way/194618330"],
    extent: ["way/194618311", "way/194618330", "way/1061978434"],
    source: STACKED_STATION_NOTE,
  },
  {
    name: "台大醫院",
    lines: ["r"],
    level: "B2",
    platforms: ["way/1228832806"],
    extent: ["way/1228832806"],
    source: `${SECTION}R09-SP(26.05)`,
  },
  // 以公告圖車站箱涵延長水平段，越過與板南線交會處；否則正線在板南線下方即爬升，高差只剩 4.3 公尺
  {
    name: "臺北車站（淡水信義線）",
    lines: ["r"],
    level: "B4",
    structure: "metro-station-r",
    platforms: ["way/741259905"],
    extent: ["way/741259905"],
    extentBoxesAt: [[50, -150]],
    source: `${SECTION}BL12/R10-SP(26.05)`,
  },
  {
    name: "中山（淡水信義線）",
    lines: ["r"],
    level: "B2",
    platforms: ["way/1054526760"],
    extent: ["way/1054526760"],
    source: `${SECTION}G14-SP(26.05)`,
  },
  {
    name: "雙連",
    lines: ["r"],
    level: "B2",
    platforms: ["way/194618328"],
    extent: ["way/194618328"],
    source: `${SECTION}R12-SP(26.05)`,
  },
  // 站區含南端的渡線：渡線兩端的正線須同高
  {
    name: "小南門",
    lines: ["g"],
    level: "B2",
    platforms: ["way/1228832765"],
    extent: ["way/1228832765", "way/871168310", "way/871168311"],
    source: `${SECTION}G11-SP(25.10)`,
  },
  {
    name: "北門",
    lines: ["g"],
    level: "B4",
    structure: "metro-station-beimen",
    platforms: ["way/194585045", "way/194585056"],
    extent: ["way/194585045", "way/194585056", "way/1226069618"],
    source: `${SECTION}G13-SP(24.01)`,
  },
  {
    name: "中山（松山新店線）",
    lines: ["g"],
    level: "B4",
    platforms: ["way/877532223"],
    extent: ["way/877532223"],
    source: `${SECTION}G14-SP(26.05)`,
  },
  {
    name: "松江南京（松山新店線）",
    lines: ["g"],
    level: "B2",
    platforms: ["way/861206851", "way/861206852"],
    extent: ["way/861206851", "way/861206852"],
    source: `${SECTION}G15/O08-SP(24.02)`,
  },
  {
    name: "松江南京（中和新蘆線）",
    lines: ["o"],
    level: "B4",
    platforms: ["way/861206847"],
    extent: ["way/861206847"],
    source: `${SECTION}G15/O08-SP(24.02)`,
  },
];

/**
 * 疊式段的水平段：自 `from` 的投影起維持 `elevation`，止於 `until` 的投影；
 * `until` 為 `{ boxAt }` 時止於鏈與包含該點的公告圖車站箱涵外牆最近的交點。
 */
export interface Hold {
  elevation: number;
  from: Local;
  until: Local | { boxAt: Local };
}

/** 正線鏈：依行進順序首尾相接的 OSM way。 */
export interface MetroChain {
  line: MetroLineId;
  /** 通過疊式車站時的層別（上層 B2、下層 B3）；不經疊式車站的路線省略。 */
  level?: Extract<LevelId, "B2" | "B3">;
  ways: string[];
  /** 站間的疊式段。 */
  holds?: Hold[];
  /** 相鄰兩站的站名；兩站之間的坡段可用 {@link STEEP_GRADE}。 */
  steep?: [string, string];
}

/** 西門站上層的軌道面（EL）；板南線疊式段的基準。 */
const XIMEN_UPPER = railLevelOf("metro-station-ximen", "B2");

/**
 * 板南線疊式段：兩條潛盾一上一下，直到進入臺北車站板南線車站箱涵（`boxAt` 在箱涵內），
 * 才在站前地下街下方的箱涵內轉為左右並列。西門至此上層維持西門 B2，
 * 下層維持 B2 減 {@link MIN_TRACK_SEPARATION}：兩管因此不相交，
 * 下層也在 (−735, −107) 與松山新店線交會處高出其 7.2 公尺。
 */
const BANNAN_HOLD = { from: [-817.4, -372.6] as Local, until: { boxAt: [-340, -76] as Local } };

/**
 * 松山新店線北門—中山的疊式段（CG291 施工標）：捷運工程叢書精進版 12《捷運工程多條隧道鄰近堆疊施工實務》
 * 第 186 頁：雙孔潛盾自北門站起由水平轉為上下疊式，通過臺北圓環後再轉回水平，兩隧道最小淨距 1.53 公尺。
 * 公告圖兩條軌道在 (−595, 435) 至 (−300, 637) 間重合，OSM 則畫成相距 9 公尺的並列。
 * 上下次序未見文獻：取西門站上層（B2 鏈）在上，高出北門 B4 月台層 {@link MIN_TRACK_SEPARATION}；
 * 下層維持 B4。
 */
const SONGSHAN_HOLD: Hold = {
  elevation: railLevelOf("metro-station-beimen", "B4") + MIN_TRACK_SEPARATION,
  from: [-595, 435],
  until: [-300, 637],
};

export const METRO_CHAINS: MetroChain[] = [
  {
    line: "bl",
    level: "B2",
    ways: ["way/198199174", "way/198199169", "way/198199171", "way/198199194"],
    holds: [{ elevation: XIMEN_UPPER, ...BANNAN_HOLD }],
  },
  {
    line: "bl",
    level: "B3",
    ways: [
      "way/111811915",
      "way/198199170",
      "way/198199196",
      "way/198199155",
      "way/198199183",
      "way/198199190",
      "way/198199193",
    ],
    holds: [{ elevation: XIMEN_UPPER - MIN_TRACK_SEPARATION, ...BANNAN_HOLD }],
  },
  // 上層自西門即下降：以 3% 到與板南線下層交會處只降到 EL −21.3，僅在其下 5.3 公尺；
  // 依表 2-3-1 註以 3.5% 可降到 −23.2，高差 7.2 公尺
  {
    line: "g",
    level: "B2",
    ways: [
      "way/24836700",
      "way/194585059",
      "way/194585060",
      "way/194585058",
      "way/194585046",
      "way/196868570",
      "way/196868575",
      "way/196868581",
    ],
    holds: [SONGSHAN_HOLD],
    steep: ["西門", "北門"],
  },
  {
    line: "g",
    level: "B3",
    ways: [
      "way/194618333",
      "way/194618337",
      "way/194585052",
      "way/194585050",
      "way/194585049",
      "way/194585053",
      "way/194585061",
      "way/196868578",
      "way/196868576",
      "way/196868574",
      "way/196868580",
    ],
  },
  {
    line: "r",
    level: "B2",
    ways: [
      "way/197881279",
      "way/194618359",
      "way/266862892",
      "way/23416669",
      "way/194618296",
      "way/194618322",
      "way/194618365",
      "way/194618334",
      "way/194618336",
    ],
  },
  {
    line: "r",
    level: "B3",
    ways: [
      "way/194618339",
      "way/194618343",
      "way/194618361",
      "way/194618326",
      "way/194618307",
      "way/194618293",
      "way/194618294",
      "way/194618346",
      "way/194618358",
    ],
  },
  { line: "o", ways: ["way/197881272", "way/198281380"] },
  { line: "o", ways: ["way/197881273", "way/198281375"] },
];

/** 鏈上各 OSM way 的 id。 */
export const CHAIN_TRACK_IDS: Set<string> = new Set(METRO_CHAINS.flatMap((chain) => chain.ways));

/** 由本模組決定高程的路線。 */
const PROFILED_LINES: Record<string, true> = { bl: true, r: true, g: true, o: true };

const dist = (a: Local, b: Local): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

let osmIndex: Map<string, OsmFeature> | null = null;

/** OSM 原始圖徵；與 `scene.ts` 同樣以地下資料集優先。 */
function osmFeature(id: string): OsmFeature {
  if (osmIndex === null) {
    osmIndex = new Map();
    for (const osm of [...underground.features, ...surface.features]) {
      if (!osmIndex.has(osm.id)) osmIndex.set(osm.id, osm);
    }
  }
  const osm = osmIndex.get(id);
  if (!osm) throw new Error(`${id} 不在 OSM 資料中`);
  return osm;
}

/** OSM 原始折線；場景的量體幾何即取自此。 */
function osmPolyline(id: string): Local[] {
  const polyline = osmFeature(id).polyline;
  if (!polyline || polyline.length < 2) throw new Error(`正線 ${id} 沒有折線`);
  return polyline;
}

/** 站區範圍圖徵的頂點：面取輪廓、線（渡線）取折線。 */
function extentVertices(id: string): Local[] {
  const osm = osmFeature(id);
  if (osm.polygon && osm.polygon.length >= 3) return osm.polygon;
  if (osm.polyline && osm.polyline.length >= 2) return osm.polyline;
  throw new Error(`站區範圍 ${id} 沒有幾何`);
}

/** 縱斷面上的水平段：車站站區或疊式段。 */
interface Anchor {
  name: string;
  from: number;
  to: number;
  elevation: number;
  /** 車站站區所屬的站；疊式段省略。 */
  stop?: MetroStop;
}

/** 鏈的縱斷面：控制點、各水平段與疊式區間（弧長）。 */
interface ChainProfile {
  chain: MetroChain;
  joined: Joined;
  cumulative: number[];
  anchors: Anchor[];
  controls: [number, number][];
  stacked: [number, number][];
}

let cachedProfiles: ChainProfile[] | null = null;

function profiles(): ChainProfile[] {
  if (cachedProfiles) return cachedProfiles;
  const bases = METRO_CHAINS.map((chain) => {
    const joined = joinChain(chain.ways, osmPolyline);
    return { chain, joined, cumulative: arcLengths(joined.points) };
  });
  cachedProfiles = bases.map((base) => {
    const { chain, joined, cumulative } = base;
    const total = cumulative[cumulative.length - 1];
    const anchors = stopAnchors(chain, joined.points, cumulative);
    for (const hold of chain.holds ?? []) anchors.push(holdAnchor(hold, joined.points, cumulative));
    anchors.sort((a, b) => a.from - b.from);
    const others = bases.filter((other) => other !== base && other.chain.line === chain.line);
    return {
      ...base,
      anchors,
      controls: controlPoints(chain, anchors, total),
      stacked: stackedIntervals(joined.points, cumulative, others),
    };
  });
  return cachedProfiles;
}

/** 各鏈的折線與縱斷面，供測試檢查疊式雙線的上下間距。 */
export function chainProfiles(): { chain: MetroChain; points: Local[]; elevationAt: (arc: number) => number }[] {
  return profiles().map(({ chain, joined, controls }) => ({
    chain,
    points: joined.points,
    elevationAt: profileOf(controls),
  }));
}

/**
 * 捷運正線上的點是否落在疊式範圍內：與某條鏈相距 {@link ZONE_REACH} 以內，且投影落在該鏈的疊式區間。
 * 範圍內的正線深度由本模組的 OSM 正線呈現，公告圖的軌道中心線在此讓位。
 * 不分路線：疊式車站內兩線並行，公告圖在此常把鄰線的參考軌道併入本線軌道。
 */
export function inStackedZone(point: Local): boolean {
  return profiles().some(({ joined, cumulative, stacked }) => {
    if (stacked.length === 0) return false;
    const { distance, arc } = nearestArc(joined.points, cumulative, point);
    return distance <= ZONE_REACH && stacked.some(([from, to]) => arc >= from && arc <= to);
  });
}

interface Joined {
  points: Local[];
  /** 各 way 在 `points` 中的頂點索引區間（相接處的頂點由前後兩段共用）。 */
  spans: { id: string; from: number; to: number }[];
}

/** 把鏈上各 way 的折線串接為一條；方向不符者反轉，接不上即擲例外。 */
function joinChain(ways: string[], polylineOf: (id: string) => Local[]): Joined {
  const points: Local[] = [];
  const spans: { id: string; from: number; to: number }[] = [];
  for (const id of ways) {
    let pts = polylineOf(id);
    if (points.length === 0) {
      if (ways.length > 1) {
        const next = polylineOf(ways[1]);
        const ends = [next[0], next[next.length - 1]];
        const meetsTail = ends.some((e) => dist(e, pts[pts.length - 1]) <= JOIN_TOLERANCE);
        const meetsHead = ends.some((e) => dist(e, pts[0]) <= JOIN_TOLERANCE);
        if (!meetsTail && !meetsHead) throw new Error(`正線鏈 ${id} 與 ${ways[1]} 不相接`);
        if (!meetsTail) pts = [...pts].reverse();
      }
      spans.push({ id, from: 0, to: pts.length - 1 });
      points.push(...pts);
      continue;
    }
    const tail = points[points.length - 1];
    if (dist(pts[0], tail) > JOIN_TOLERANCE && dist(pts[pts.length - 1], tail) <= JOIN_TOLERANCE) {
      pts = [...pts].reverse();
    }
    if (dist(pts[0], tail) > JOIN_TOLERANCE) throw new Error(`正線鏈 ${id} 與前一段不相接`);
    const from = points.length - 1;
    points.push(...pts.slice(1));
    spans.push({ id, from, to: points.length - 1 });
  }
  return { points, spans };
}

/** 各頂點的累積弧長。 */
function arcLengths(points: Local[]): number[] {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + dist(points[i - 1], points[i]));
  return cumulative;
}

/** 弧長位置的座標。 */
function pointAtArc(points: Local[], cumulative: number[], s: number): Local {
  if (s <= 0) return points[0];
  const total = cumulative[cumulative.length - 1];
  if (s >= total) return points[points.length - 1];
  let i = 1;
  while (i < cumulative.length && cumulative[i] < s) i++;
  const span = cumulative[i] - cumulative[i - 1];
  const t = span > 0 ? (s - cumulative[i - 1]) / span : 0;
  const a = points[i - 1];
  const b = points[i];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** 取出兩個弧長位置之間的子折線，兩端為內插出的點。 */
function sliceByArc(points: Local[], cumulative: number[], from: number, to: number): Local[] {
  const part: Local[] = [pointAtArc(points, cumulative, from)];
  for (let i = 0; i < points.length; i++) {
    if (cumulative[i] <= from) continue;
    if (cumulative[i] >= to) break;
    part.push(points[i]);
  }
  part.push(pointAtArc(points, cumulative, to));
  // 內插端點與既有頂點重合時去除重複
  return part.filter((p, i) => i === 0 || dist(p, part[i - 1]) > 1e-6);
}

/** 以二分法求斷言在線段上的切換位置（弧長）。 */
function crossingArc(
  points: Local[],
  cumulative: number[],
  i: number,
  inside: (p: Local) => boolean,
): number {
  let lo = cumulative[i];
  let hi = cumulative[i + 1];
  const loInside = inside(points[i]);
  for (let n = 0; n < 24; n++) {
    const mid = (lo + hi) / 2;
    if (inside(pointAtArc(points, cumulative, mid)) === loInside) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** 鏈通過某站時的層別；疊式車站取鏈的層別。 */
function stopLevel(stop: MetroStop, chain: MetroChain): LevelId {
  if (stop.level !== "stacked") return stop.level;
  if (chain.level === undefined) throw new Error(`鏈 ${chain.ways[0]} 經過疊式車站 ${stop.name}，卻未指定層別`);
  return chain.level;
}

/** 鏈上停靠本路線各站的站區：站區範圍各頂點投影到鏈上的弧長區間，軌道面為該站月台層。 */
function stopAnchors(chain: MetroChain, points: Local[], cumulative: number[]): Anchor[] {
  const anchors: Anchor[] = [];
  for (const stop of METRO_STOPS) {
    if (!stop.lines.includes(chain.line)) continue;
    const vertices = [
      ...stop.extent.flatMap(extentVertices),
      ...(stop.extentBoxesAt ?? []).flatMap(dortsStationBoxAt),
    ];
    const arcs = vertices.flatMap((p) => {
      const { distance, arc } = nearestArc(points, cumulative, p);
      return distance <= EXTENT_REACH ? [arc] : [];
    });
    if (arcs.length === 0) throw new Error(`鏈 ${chain.ways[0]} 未經過 ${stop.name}`);
    anchors.push({
      name: stop.name,
      from: Math.min(...arcs),
      to: Math.max(...arcs),
      elevation: railLevelOf(stop.structure, stopLevel(stop, chain)),
      stop,
    });
  }
  return anchors;
}

/** 疊式段：自 `from` 的投影起，到 `until` 的投影或鏈與指定車站箱涵外牆最近的交點止。 */
function holdAnchor(hold: Hold, points: Local[], cumulative: number[]): Anchor {
  const start = nearestArc(points, cumulative, hold.from).arc;
  let end: number;
  if (Array.isArray(hold.until)) {
    end = nearestArc(points, cumulative, hold.until).arc;
  } else {
    const box = dortsStationBoxAt(hold.until.boxAt);
    const inside = (p: Local): boolean => pointInPolygon(p, box);
    const walls: number[] = [];
    for (let i = 0; i + 1 < points.length; i++) {
      if (inside(points[i]) !== inside(points[i + 1])) walls.push(crossingArc(points, cumulative, i, inside));
    }
    if (walls.length === 0) throw new Error(`正線鏈未進入 ${hold.until.boxAt} 的車站箱涵`);
    end = walls.reduce((best, s) => (Math.abs(s - start) < Math.abs(best - start) ? s : best));
  }
  return { name: "疊式段", from: Math.min(start, end), to: Math.max(start, end), elevation: hold.elevation };
}

/**
 * 鏈的縱斷面控制點（弧長、軌道面高程）。各水平段之間以 {@link MAX_GRADE} 連接，
 * 坡段緊鄰較淺的一段：較淺者在後即於其起點爬升到頂，在前即自其終點開始下降；
 * 鏈首與鏈尾沿用最近一段的高程。坡段長於兩段的間距即擲例外，不以加大坡度矇混。
 */
function controlPoints(chain: MetroChain, anchors: Anchor[], total: number): [number, number][] {
  if (anchors.length === 0) throw new Error(`鏈 ${chain.ways[0]} 沒有任何車站`);
  const controls: [number, number][] = [[0, anchors[0].elevation]];
  anchors.forEach((b, i) => {
    if (i > 0) {
      const a = anchors[i - 1];
      if (b.from < a.to) throw new Error(`鏈 ${chain.ways[0]} 的 ${a.name} 與 ${b.name} 重疊`);
      const steep =
        chain.steep !== undefined &&
        ((chain.steep[0] === a.name && chain.steep[1] === b.name) ||
          (chain.steep[0] === b.name && chain.steep[1] === a.name));
      const rise = b.elevation - a.elevation;
      const length = Math.abs(rise) / (steep ? STEEP_GRADE : MAX_GRADE);
      const gap = b.from - a.to;
      if (length > gap + 1e-6) {
        throw new Error(
          `${chain.ways[0]} ${a.name}→${b.name} 需 ${length.toFixed(1)} 公尺，僅有 ${gap.toFixed(1)} 公尺`,
        );
      }
      if (rise > 0) controls.push([b.from - length, a.elevation]);
      else if (rise < 0) controls.push([a.to + length, b.elevation]);
    }
    controls.push([b.from, b.elevation], [b.to, b.elevation]);
  });
  controls.push([total, anchors[anchors.length - 1].elevation]);
  return controls;
}

/** 鏈上與同路線另一條鏈在平面上相距小於 {@link STACKED_PLAN} 的弧長區間。 */
function stackedIntervals(
  points: Local[],
  cumulative: number[],
  others: { joined: Joined; cumulative: number[] }[],
): [number, number][] {
  const total = cumulative[cumulative.length - 1];
  const intervals: [number, number][] = [];
  let start: number | null = null;
  let last = 0;
  for (let s = 0; ; s += STACKED_STEP) {
    const at = Math.min(s, total);
    const p = pointAtArc(points, cumulative, at);
    const near = others.some((o) => nearestArc(o.joined.points, o.cumulative, p).distance < STACKED_PLAN);
    if (near) {
      start ??= at;
      last = at;
    } else if (start !== null) {
      intervals.push([start, last]);
      start = null;
    }
    if (at >= total) break;
  }
  if (start !== null) intervals.push([start, last]);
  return intervals.filter(([from, to]) => to - from > STACKED_MIN);
}

/** 點到折線的距離與最近點的累積弧長。 */
function nearestArc(points: Local[], cumulative: number[], p: Local): { distance: number; arc: number } {
  let best = { distance: Infinity, arc: 0 };
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const [vx, vy] = [b[0] - a[0], b[1] - a[1]];
    const len2 = vx * vx + vy * vy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2));
    const distance = Math.hypot(a[0] + vx * t - p[0], a[1] + vy * t - p[1]);
    if (distance < best.distance) best = { distance, arc: cumulative[i - 1] + t * Math.sqrt(len2) };
  }
  return best;
}

/** 鏈與疊式範圍界線的交點（弧長，遞增）；與公告圖軌道的裁切位置一致。 */
function zoneCrossings(points: Local[], cumulative: number[]): number[] {
  const flags = points.map(inStackedZone);
  const crossings: number[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    if (flags[i] !== flags[i + 1]) crossings.push(crossingArc(points, cumulative, i, inStackedZone));
  }
  return crossings;
}

/** 控制點之間線性內插的縱斷面。 */
function profileOf(controls: [number, number][]): (s: number) => number {
  return (s: number): number => {
    if (s <= controls[0][0]) return controls[0][1];
    for (let i = 1; i < controls.length; i++) {
      const [a, ea] = controls[i - 1];
      const [b, eb] = controls[i];
      if (s > b) continue;
      return b > a ? ea + ((eb - ea) * (s - a)) / (b - a) : eb;
    }
    return controls[controls.length - 1][1];
  };
}

/**
 * 切段位置：縱斷面轉折點、各 way 的交界、疊式範圍的界線、公告圖軌道端點的投影（弧長）。
 * 範圍外的段落因此整段在界外，可由公告圖軌道取代；公告圖軌道止於涵蓋範圍中途時，
 * 其外的段落才不會因少數頂點離公告圖太遠而整段保留，與公告圖軌道重疊。
 */
function cutsOf(
  controls: [number, number][],
  crossings: number[],
  handovers: number[],
  joined: Joined,
  cumulative: number[],
): number[] {
  const total = cumulative[cumulative.length - 1];
  const cuts = [
    0,
    total,
    ...controls.map(([s]) => s),
    ...joined.spans.map((s) => cumulative[s.to]),
    ...crossings,
    ...handovers,
  ];
  return [...new Set(cuts.map((s) => Math.min(total, Math.max(0, s))))]
    .sort((a, b) => a - b)
    .filter((s, i, all) => i === 0 || s - all[i - 1] > 0.5);
}

const PROFILE_NOTE =
  "軌道面依各站月台層（臺北捷運〈車站剖面相關位置圖〉；未有文獻高程者取預設樓層表）連接，" +
  "月台範圍內水平，站間坡度不超過 3%（捷運工程叢書 9 表 2-3-1）；" +
  "西門—北門間松山新店線上行依同表註以 3.5% 下穿板南線。";

/** 段落的層別與構造物：中點落在站區者取該站月台層，其餘依高程與路線構造物。 */
function pieceAttributes(
  profile: ChainProfile,
  middle: number,
  base: number,
  baseEnd: number,
): { level: LevelId; structure: StructureId } {
  const { chain, anchors } = profile;
  const lineStructure = METRO_LINES[chain.line].structure;
  const run = anchors.find((a) => a.stop !== undefined && middle >= a.from && middle <= a.to);
  if (run?.stop) {
    return { level: stopLevel(run.stop, chain), structure: run.stop.structure ?? lineStructure };
  }
  return { level: levelLabelFor(Math.min(base, baseEnd)), structure: lineStructure };
}

/** 依段落兩端高程寫入 `base`／`baseEnd`；兩端等高時不留 `baseEnd`。 */
function withEnds(piece: Feature, base: number, baseEnd: number): Feature {
  piece.base = base;
  if (Math.abs(baseEnd - base) > 1e-6) piece.baseEnd = baseEnd;
  else delete piece.baseEnd;
  return piece;
}

/**
 * 依縱斷面把各鏈的正線切段，就地改寫 `features`：
 * 原 way 移除，換成各段（id 沿用 `way/xxx#n` 的切片慣例）。
 */
export function reprofileChains(features: Map<string, Feature>): void {
  for (const profile of profiles()) {
    const { chain, joined, cumulative, controls } = profile;
    for (const id of chain.ways) {
      if (!features.get(id)?.geometry.polyline) throw new Error(`正線 ${id} 不在場景中`);
    }
    const { points, spans } = joined;
    const elevationAt = profileOf(controls);
    const handovers = dortsTrackEnds().flatMap(({ line, point }) => {
      if (line !== chain.line) return [];
      const { distance, arc } = nearestArc(points, cumulative, point);
      return distance <= HANDOVER_REACH ? [arc] : [];
    });
    const cuts = cutsOf(controls, zoneCrossings(points, cumulative), handovers, joined, cumulative);

    const counts = new Map<string, number>();
    const emitted: Feature[] = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const [from, to] = [cuts[i], cuts[i + 1]];
      const middle = (from + to) / 2;
      const span = spans.find((s) => cumulative[s.from] <= middle && middle <= cumulative[s.to]);
      if (span === undefined) continue;
      const source = features.get(span.id) as Feature;
      const base = elevationAt(from);
      const baseEnd = elevationAt(to);
      const piece: Feature = {
        ...source,
        id: span.id,
        geometry: { polyline: sliceByArc(points, cumulative, from, to) },
        ...pieceAttributes(profile, middle, base, baseEnd),
        confidence: "estimated",
        sourceNote: PROFILE_NOTE,
      };
      emitted.push(withEnds(piece, base, baseEnd));
      counts.set(span.id, (counts.get(span.id) ?? 0) + 1);
    }

    for (const id of chain.ways) features.delete(id);
    const index = new Map<string, number>();
    for (const piece of emitted) {
      const n = index.get(piece.id) ?? 0;
      index.set(piece.id, n + 1);
      const id = (counts.get(piece.id) as number) === 1 ? piece.id : `${piece.id}#${n}`;
      features.set(id, { ...piece, id });
    }
  }
}

/** 投影位置與其在鏈上的弧長。 */
interface Projected {
  point: Local;
  arc: number;
}

/** 把軌道依鏈的控制點弧長切段；切點以二分法在線段參數上求得。 */
function splitAtControls(polyline: Local[], profile: ChainProfile): Projected[][] {
  const { joined, cumulative, controls } = profile;
  const arcOf = (p: Local): number => nearestArc(joined.points, cumulative, p).arc;
  const controlArcs = [...new Set(controls.map(([s]) => s))];
  const pieces: Projected[][] = [];
  let current: Projected[] = [{ point: polyline[0], arc: arcOf(polyline[0]) }];
  for (let i = 1; i < polyline.length; i++) {
    const a = polyline[i - 1];
    const b = polyline[i];
    const arcA = current[current.length - 1].arc;
    const arcB = arcOf(b);
    const at = (t: number): Local => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const splits = controlArcs
      .filter((c) => c > Math.min(arcA, arcB) + 1e-6 && c < Math.max(arcA, arcB) - 1e-6)
      .map((c) => {
        let lo = 0;
        let hi = 1;
        const below = arcA < c;
        for (let n = 0; n < 24; n++) {
          const mid = (lo + hi) / 2;
          if (arcOf(at(mid)) < c === below) lo = mid;
          else hi = mid;
        }
        return { t: (lo + hi) / 2, arc: c };
      })
      .sort((x, y) => x.t - y.t);
    for (const split of splits) {
      const cut = { point: at(split.t), arc: split.arc };
      current.push(cut);
      pieces.push(current);
      current = [cut];
    }
    current.push({ point: b, arc: arcB });
  }
  pieces.push(current);
  return pieces;
}

/** 頂點到鏈的距離中位數。 */
function medianDistance(polyline: Local[], profile: ChainProfile): number {
  const distances = polyline
    .map((p) => nearestArc(profile.joined.points, profile.cumulative, p).distance)
    .sort((a, b) => a - b);
  return distances[Math.floor(distances.length / 2)];
}

/**
 * 鏈以外的捷運軌道（公告圖軌道、OSM 渡線與側線）依同路線最近的鏈取得高程：
 * 各頂點投影到鏈上，在控制點處切段，各段兩端取鏈上的高程。
 * 頂點距離中位數超過 {@link PROFILE_REACH} 者不在任何鏈旁，原樣保留。
 */
export function profileLineTracks(features: Feature[]): Feature[] {
  const result: Feature[] = [];
  for (const feature of features) {
    const polyline = feature.geometry.polyline;
    if (
      feature.kind !== "track-metro" ||
      feature.line === undefined ||
      PROFILED_LINES[feature.line] !== true ||
      !polyline ||
      polyline.length < 2 ||
      CHAIN_TRACK_IDS.has(feature.id.split("#")[0])
    ) {
      result.push(feature);
      continue;
    }
    let best: { profile: ChainProfile; distance: number } | undefined;
    for (const profile of profiles()) {
      if (profile.chain.line !== feature.line) continue;
      const distance = medianDistance(polyline, profile);
      if (best === undefined || distance < best.distance) best = { profile, distance };
    }
    if (best === undefined || best.distance > PROFILE_REACH) {
      result.push(feature);
      continue;
    }
    const { profile } = best;
    const elevationAt = profileOf(profile.controls);
    const pieces = splitAtControls(polyline, profile);
    pieces.forEach((piece, n) => {
      const first = piece[0].arc;
      const last = piece[piece.length - 1].arc;
      const base = elevationAt(first);
      const baseEnd = elevationAt(last);
      const profiled: Feature = {
        ...feature,
        id: pieces.length === 1 ? feature.id : `${feature.id}#${n}`,
        geometry: { ...feature.geometry, polyline: piece.map((p) => p.point) },
        ...pieceAttributes(profile, (first + last) / 2, base, baseEnd),
        confidence: "estimated",
        sourceNote: feature.id.startsWith("dorts/") ? `${DORTS_SOURCE}的軌道中心線；${PROFILE_NOTE}` : PROFILE_NOTE,
      };
      result.push(withEnds(profiled, base, baseEnd));
    });
  }
  return result;
}

/** 相鄰圖幅的同一軌道：端部與同路線較長的軌道在此距離內重合（公尺）。 */
const OVERLAP_DISTANCE = 1.5;
/** 端部重合達此長度才截去（公尺）；道岔處分歧的端部重合不到此長度。 */
const SHEET_OVERLAP = 30;

/**
 * 相鄰圖幅的同一軌道各畫一段、端部互相重疊時，重疊率不足以整條去除；
 * 較短者自端部起與同路線較長軌道重合 {@link SHEET_OVERLAP} 以上的部分截去，否則同一段會產生兩條圓管。
 */
function trimSheetOverlaps(tracks: Feature[]): Feature[] {
  const lengths = new Map(tracks.map((t) => [t, polylineLength(t.geometry.polyline as Local[])]));
  return tracks.flatMap((track) => {
    const line = track.geometry.polyline as Local[];
    const length = lengths.get(track) as number;
    const others = tracks.filter((o) => o !== track && o.line === track.line && (lengths.get(o) as number) > length);
    if (others.length === 0) return [track];
    const covered = line.map((p) =>
      others.some((o) => nearestOnPolyline(p, o.geometry.polyline as Local[]).distance <= OVERLAP_DISTANCE),
    );
    let head = 0;
    while (head < line.length && covered[head]) head++;
    let tail = line.length - 1;
    while (tail >= 0 && covered[tail]) tail--;
    // 保留重合段的最後一點，截去後仍與較長的軌道相接
    const from = head > 0 && polylineLength(line.slice(0, head)) >= SHEET_OVERLAP ? head - 1 : 0;
    const to = tail < line.length - 1 && polylineLength(line.slice(tail + 1)) >= SHEET_OVERLAP ? tail + 1 : line.length - 1;
    if (to - from < 1) return [];
    if (from === 0 && to === line.length - 1) return [track];
    return [{ ...track, geometry: { ...track.geometry, polyline: line.slice(from, to + 1) } }];
  });
}

/**
 * 公告圖的軌道中心線在疊式範圍內只畫一條，上下兩軌無從區分；
 * 疊式範圍內的部分改由本模組切段的 OSM 正線呈現，在此裁去。
 * 公告圖常把鄰線的參考軌道併入本線軌道（如西門站南側的松山新店線併入板南線軌道），
 * 整條比對時不算重複，裁切後的片段卻與另一條軌道重疊，故裁切後再去除一次重複，
 * 並截去相鄰圖幅端部重疊的部分。
 */
export function trimDortsTracks(features: Feature[]): Feature[] {
  const result: Feature[] = [];
  for (const feature of features) {
    const polyline = feature.geometry.polyline;
    if (feature.kind !== "track-metro" || !feature.id.startsWith("dorts/") || !polyline) {
      result.push(feature);
      continue;
    }
    if (!polyline.some(inStackedZone)) {
      result.push(feature);
      continue;
    }
    const cumulative = arcLengths(polyline);
    // 疊式範圍外的各段各成一項；界線以二分法求交點
    const parts: Local[][] = [];
    let current: Local[] = [];
    for (let i = 0; i < polyline.length; i++) {
      const outside = !inStackedZone(polyline[i]);
      if (outside) {
        if (current.length === 0 && i > 0) {
          current.push(pointAtArc(polyline, cumulative, crossingArc(polyline, cumulative, i - 1, inStackedZone)));
        }
        current.push(polyline[i]);
        continue;
      }
      if (current.length > 0) {
        current.push(pointAtArc(polyline, cumulative, crossingArc(polyline, cumulative, i - 1, inStackedZone)));
        parts.push(current);
        current = [];
      }
    }
    if (current.length > 0) parts.push(current);
    const kept = parts.filter((part) => part.length >= 2);
    kept.forEach((part, n) => {
      const id = kept.length === 1 ? feature.id : `${feature.id}#${n}`;
      result.push({ ...feature, id, geometry: { ...feature.geometry, polyline: part } });
    });
  }
  const isTrack = (f: Feature): boolean => f.kind === "track-metro" && f.id.startsWith("dorts/");
  const unique = dedupePolylines(
    result.filter(isTrack),
    (f) => f.geometry.polyline as Local[],
    (f) => f.id,
  );
  const trimmed = new Map(trimSheetOverlaps(unique).map((f) => [f.id, f]));
  return result.flatMap((f) => {
    if (!isTrack(f)) return [f];
    const track = trimmed.get(f.id);
    return track ? [track] : [];
  });
}

/** 公告圖軌道與 OSM 正線交接時，端點視為同一處的距離上限（公尺）。 */
const HANDOVER_REACH = 15;
/** 交接漸移的長度（公尺）。 */
const HANDOVER_TAPER = 60;
/** 端點相距小於此值即視為已銜接（公尺）。 */
const HANDOVER_JOINED = 0.05;
/** 漸移段的頂點間距上限（公尺）：OSM 頂點稀疏，不加密會把漸移曲線畫成折線。 */
const HANDOVER_STEP = 2;
/** 同一條 OSM 正線切出的段落共用端點；相距小於此值即視為首尾相接（公尺）。 */
const PIECE_JOIN = 1e-6;

/** 朝交接端排列的 OSM 段落：`pts` 的末點朝向交接端，`reversed` 表示與原方向相反。 */
interface OrientedPiece {
  feature: Feature;
  pts: Local[];
  reversed: boolean;
}

/** 加密折線：弧長 `from` 之後的各段每 {@link HANDOVER_STEP} 公尺內補一個頂點。 */
function densifyAfter(pts: Local[], from: number): Local[] {
  const out: Local[] = [pts[0]];
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const seg = dist(a, b);
    if (walked + seg > from) {
      const n = Math.ceil(seg / HANDOVER_STEP);
      for (let k = 1; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    out.push(b);
    walked += seg;
  }
  return out;
}

/**
 * 公告圖軌道與 OSM 正線的交接：兩者的端點常相差數公尺，接成段差。
 * 對每條公告圖軌道的兩端，取同路線 OSM 正線中端點最近者（{@link HANDOVER_REACH} 內），
 * 自該端往回串接首尾相接的 OSM 段落，在末端 {@link HANDOVER_TAPER} 公尺內漸移到公告圖端點；
 * 疊式站區的切段可能短於漸移長度，只移動單一段落會在段落交界留下折角。
 * 每個 OSM 端點只處理一次；回傳以 id 為鍵的新量體，高程不變。
 */
export function alignHandovers(osm: Feature[], dorts: Feature[]): Map<string, Feature> {
  const candidates = osm.filter(
    (f) => f.kind === "track-metro" && !f.id.startsWith("dorts/") && (f.geometry.polyline?.length ?? 0) >= 2,
  );
  const aligned = new Map<string, Feature>();
  const latest = (f: Feature): Feature => aligned.get(f.id) ?? f;
  const oriented = (f: Feature, reversed: boolean): OrientedPiece => {
    const pts = latest(f).geometry.polyline as Local[];
    return { feature: latest(f), pts: reversed ? [...pts].reverse() : pts, reversed };
  };
  const handled = new Set<string>();
  for (const track of dorts) {
    const line = track.geometry.polyline;
    if (track.kind !== "track-metro" || !line || line.length < 2) continue;
    for (const end of [line[0], line[line.length - 1]]) {
      let best: { feature: Feature; atStart: boolean; distance: number } | undefined;
      for (const candidate of candidates) {
        if (candidate.line !== track.line) continue;
        const pts = latest(candidate).geometry.polyline as Local[];
        for (const atStart of [true, false]) {
          if (handled.has(`${candidate.id}|${atStart}`)) continue;
          const distance = dist(atStart ? pts[0] : pts[pts.length - 1], end);
          if (distance <= HANDOVER_REACH && (!best || distance < best.distance)) {
            best = { feature: candidate, atStart, distance };
          }
        }
      }
      if (!best) continue;
      handled.add(`${best.feature.id}|${best.atStart}`);
      if (best.distance < HANDOVER_JOINED) continue;

      // 末段方向上的縱向與左側偏移；OSM 端點越過公告圖端點時先截短，免得末點折返
      const last = oriented(best.feature, best.atStart);
      const [a, b] = [last.pts[last.pts.length - 2], last.pts[last.pts.length - 1]];
      const [ux, uy] = [(b[0] - a[0]) / dist(a, b), (b[1] - a[1]) / dist(a, b)];
      const along = ux * (end[0] - b[0]) + uy * (end[1] - b[1]);
      const offset = ux * (end[1] - b[1]) - uy * (end[0] - b[0]);
      const lastLength = polylineLength(last.pts);
      if (along < 0 && lastLength + along > 1) last.pts = slicePolyline(last.pts, 0, lastLength + along);

      // 自交接端往回串接首尾相接的同路線段落，湊足漸移長度
      const path: OrientedPiece[] = [last];
      let length = polylineLength(last.pts);
      while (length < HANDOVER_TAPER) {
        const head = path[0].pts[0];
        const previous = candidates.find((c) => {
          if (c.line !== track.line || path.some((p) => p.feature.id === c.id)) return false;
          const pts = latest(c).geometry.polyline as Local[];
          return dist(pts[0], head) < PIECE_JOIN || dist(pts[pts.length - 1], head) < PIECE_JOIN;
        });
        if (!previous) break;
        const pts = latest(previous).geometry.polyline as Local[];
        const piece = oriented(previous, dist(pts[pts.length - 1], head) >= PIECE_JOIN);
        path.unshift(piece);
        length += polylineLength(piece.pts);
      }

      // 串成一條加密後漸移，再依各段的頂點數拆回
      const start = Math.max(0, length - HANDOVER_TAPER);
      const joined: Local[] = [];
      const counts: number[] = [];
      let walked = 0;
      for (const piece of path) {
        const dense = densifyAfter(piece.pts, start - walked);
        joined.push(...(joined.length === 0 ? dense : dense.slice(1)));
        counts.push(dense.length);
        walked += polylineLength(piece.pts);
      }
      // 漸移式同 `taperedOffset`（3u²−2u³）；法向取前後各 1 公尺的弦，
      // 段落交界的重合頂點才不會因相鄰頂點不同而各自偏向
      const cumulative = arcLengths(joined);
      const shifted = joined.map((p, i): Local => {
        const u = Math.min(1, Math.max(0, (cumulative[i] - start) / (length - start)));
        if (u === 0) return p;
        const e = offset * u * u * (3 - 2 * u);
        const a = pointAtArc(joined, cumulative, cumulative[i] - 1);
        const b = pointAtArc(joined, cumulative, cumulative[i] + 1);
        const chord = dist(a, b) || 1;
        return [p[0] - ((b[1] - a[1]) / chord) * e, p[1] + ((b[0] - a[0]) / chord) * e];
      });
      shifted[shifted.length - 1] = end;
      let index = 0;
      path.forEach((piece, k) => {
        const pts = shifted.slice(index, index + counts[k]);
        index += counts[k] - 1;
        if (piece.reversed) pts.reverse();
        aligned.set(piece.feature.id, {
          ...piece.feature,
          geometry: { ...piece.feature.geometry, polyline: pts },
        });
      });
    }
  }
  return aligned;
}

/**
 * 西門站的下層月台：OSM 只畫了上層（`way/877532225`），
 * 依疊式配置於同一平面複製一塊。中正紀念堂兩層月台 OSM 均有，不另產生。
 */
export function stackedPlatforms(): Feature[] {
  const polygon = (() => {
    for (const osm of underground.features) {
      if (osm.id === "way/877532225" && osm.polygon) return osm.polygon;
    }
    throw new Error("找不到西門站上層月台 way/877532225");
  })();
  return [
    {
      id: "ximen/platform/B3",
      kind: "platform",
      name: "捷運西門站下層月台",
      level: "B3",
      layer: "platform",
      structure: "metro-station-ximen",
      geometry: { polygon },
      base: railLevelOf("metro-station-ximen", "B3"),
      height: PLATFORM_RISE,
      confidence: "estimated",
      sourceNote: `${STACKED_STATION_NOTE}OSM 僅繪出上層月台，下層依疊式配置於同一平面複製。`,
      status: "existing",
    },
  ];
}
