/**
 * 捷運正線的縱斷面：依各站月台層決定本範圍每條捷運正線的軌道面高程。
 *
 * 站表 {@link METRO_STOPS}：每座車站的月台層出自臺北捷運〈車站剖面相關位置圖〉
 * （BL10-SP、BL12/R10-SP、BL13-SP、BL14/O07-SP、R09-SP、R12-SP、G11-SP、G13-SP、G14-SP、G15/O08-SP），
 * 有文獻高程者（臺北車站、北門）取構造物樓層表，其餘取預設樓層表。
 * 西門、中正紀念堂為上下疊式月台，層別由通過的鏈決定。
 *
 * 正線鏈 {@link METRO_CHAINS}：依行車方向首尾相接的 OSM way，每條路線每個行車方向各一條。
 * 各站月台、站體與渡線投影到鏈上的範圍內軌道水平；相鄰兩站以 {@link MAX_GRADE} 連接，
 * 坡段緊鄰較淺的一站，即較深的一站水平延伸到坡底才爬升，與鏈的方向無關。
 * 依據為捷運工程叢書精進版 9《捷運軌道工程實務》表 2-3-1：主線最大縱坡 3%（絕對需求），
 * 特殊短區間經捷運局同意可至 4%，站內水平；本模型只在鏈的 `steep` 指定處用 {@link STEEP_GRADE}。
 * 站間的疊式段（{@link Hold}）另以水平段指定，與車站同樣參與坡段的配置。
 *
 * 正線的平面幾何（公告圖軌道中心線、OSM 補足與平滑）由 `metro-network.ts` 組成，
 * 本模組以 {@link chainControls} 在該平面折線上求出縱斷面控制點。
 */
import undergroundJson from "../osm/underground.json";
import surfaceJson from "../osm/surface.json";
import type { OsmDataset, OsmFeature } from "../osm-types.ts";
import { pointInPolygon } from "../../geo/measure.ts";
import type { Local } from "../../geo/project.ts";
import { STACKED_STATION_NOTE, railLevelOf, type MetroLineId, type StructureId } from "../levels.ts";
import { dortsStationBoxAt } from "../dorts.ts";
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

/** 站區範圍的頂點與鏈相距超過此值即不界定該鏈的站區（公尺）：另一條路線的月台與站體。 */
const EXTENT_REACH = 30;

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

/** 正線鏈：依行車方向首尾相接的 OSM way。 */
export interface MetroChain {
  /** 正線量體的 id，例如 `metro/bl/to-nangang`。 */
  id: string;
  line: MetroLineId;
  /** 行車方向的終點站名，用於量體名稱。 */
  toward: string;
  /**
   * 行車方向：組成後的折線若首點比末點更偏向此方向（東西比 x、南北比 y）即反轉，
   * 使折線沿行車方向排列。
   */
  ends: "east" | "west" | "north" | "south";
  /** 通過疊式車站時的層別（上層 B2、下層 B3）；不經疊式車站的路線省略。 */
  level?: Extract<LevelId, "B2" | "B3">;
  ways: string[];
  /** 站間的疊式段。 */
  holds?: Hold[];
  /** 相鄰兩站的站名；兩站之間的坡段可用 {@link STEEP_GRADE}。 */
  steep?: [string, string];
}

/** 西門站上層的軌道面（EL）；板南線疊式段的基準。 */
export const XIMEN_UPPER = railLevelOf("metro-station-ximen", "B2");

/**
 * 板南線疊式段：兩條潛盾一上一下，直到進入臺北車站板南線車站箱涵（`boxAt` 在箱涵內），
 * 才在站前地下街下方的箱涵內轉為左右並列。上層為往南港展覽館（維基百科〈西門站〉：
 * B2 為板南線往南港展覽館與松山新店線往松山，B3 為往頂埔與往新店），西門至此維持西門 B2；
 * 往頂埔維持 B2 減 {@link MIN_TRACK_SEPARATION}：兩管因此不相交，
 * 下層也在 (−735, −107) 與松山新店線交會處高出其 7.2 公尺。
 */
const BANNAN_HOLD = { from: [-817.4, -372.6] as Local, until: { boxAt: [-340, -76] as Local } };

/**
 * 松山新店線北門—中山的疊式段（CG291 施工標）：捷運工程叢書精進版 12《捷運工程多條隧道鄰近堆疊施工實務》
 * 第 186 頁：雙孔潛盾自北門站起由水平轉為上下疊式，通過臺北圓環後再轉回水平，兩隧道最小淨距 1.53 公尺。
 * 公告圖兩條軌道在 (−595, 435) 至 (−300, 637) 間重合，OSM 則畫成相距 9 公尺的並列。
 * 上下次序未見文獻：取西門站上層的往松山在上，高出北門 B4 月台層 {@link MIN_TRACK_SEPARATION}；
 * 往新店維持 B4。
 */
const SONGSHAN_HOLD: Hold = {
  elevation: railLevelOf("metro-station-beimen", "B4") + MIN_TRACK_SEPARATION,
  from: [-595, 435],
  until: [-300, 637],
};

export const METRO_CHAINS: MetroChain[] = [
  {
    id: "metro/bl/to-nangang",
    line: "bl",
    toward: "南港展覽館",
    ends: "east",
    level: "B2",
    ways: [
      "way/111811915",
      "way/198199170",
      "way/198199196",
      "way/198199155",
      "way/198199183",
      "way/198199190",
      "way/198199193",
    ],
    holds: [{ elevation: XIMEN_UPPER, ...BANNAN_HOLD }],
  },
  {
    id: "metro/bl/to-dingpu",
    line: "bl",
    toward: "頂埔",
    ends: "west",
    level: "B3",
    ways: ["way/198199174", "way/198199169", "way/198199171", "way/198199194"],
    holds: [{ elevation: XIMEN_UPPER - MIN_TRACK_SEPARATION, ...BANNAN_HOLD }],
  },
  // 往松山自西門即下降：以 3% 到與板南線往頂埔交會處只降到 EL −21.3，僅在其下 5.3 公尺；
  // 依表 2-3-1 註以 3.5% 可降到 −23.2，高差 7.2 公尺
  {
    id: "metro/g/to-songshan",
    line: "g",
    toward: "松山",
    ends: "east",
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
    id: "metro/g/to-xindian",
    line: "g",
    toward: "新店",
    ends: "west",
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
    id: "metro/r/to-tamsui",
    line: "r",
    toward: "淡水",
    ends: "north",
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
    id: "metro/r/to-xiangshan",
    line: "r",
    toward: "象山",
    ends: "south",
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
  { id: "metro/o/to-luzhou", line: "o", toward: "迴龍、蘆洲", ends: "north", ways: ["way/197881273", "way/198281375"] },
  { id: "metro/o/to-nanshijiao", line: "o", toward: "南勢角", ends: "south", ways: ["way/197881272", "way/198281380"] },
];

const dist = (a: Local, b: Local): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

let osmIndex: Map<string, OsmFeature> | null = null;

/** OSM 原始圖徵；與 `scene.ts` 同樣以地下資料集優先。 */
export function osmFeature(id: string): OsmFeature {
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
export function osmPolyline(id: string): Local[] {
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

/**
 * 鏈在平面折線 `points`（已組成的正線）上的縱斷面控制點（弧長、軌道面高程）：
 * 各站站區與疊式段投影到折線上成為水平段，再以 {@link controlPoints} 連接。
 */
export function chainControls(chain: MetroChain, points: Local[]): [number, number][] {
  const cumulative = arcLengths(points);
  const anchors = stopAnchors(chain, points, cumulative);
  for (const hold of chain.holds ?? []) anchors.push(holdAnchor(hold, points, cumulative));
  anchors.sort((a, b) => a.from - b.from);
  return controlPoints(chain, anchors, cumulative[cumulative.length - 1]);
}

export interface Joined {
  points: Local[];
  /** 各 way 在 `points` 中的頂點索引區間（相接處的頂點由前後兩段共用）。 */
  spans: { id: string; from: number; to: number }[];
}

/** 把鏈上各 way 的折線串接為一條；方向不符者反轉，接不上即擲例外。 */
export function joinChain(ways: string[], polylineOf: (id: string) => Local[]): Joined {
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
export function arcLengths(points: Local[]): number[] {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + dist(points[i - 1], points[i]));
  return cumulative;
}

/** 弧長位置的座標。 */
export function pointAtArc(points: Local[], cumulative: number[], s: number): Local {
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
  if (chain.level === undefined) throw new Error(`鏈 ${chain.id} 經過疊式車站 ${stop.name}，卻未指定層別`);
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
    if (arcs.length === 0) throw new Error(`鏈 ${chain.id} 未經過 ${stop.name}`);
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
  if (anchors.length === 0) throw new Error(`鏈 ${chain.id} 沒有任何車站`);
  const controls: [number, number][] = [[0, anchors[0].elevation]];
  anchors.forEach((b, i) => {
    if (i > 0) {
      const a = anchors[i - 1];
      if (b.from < a.to) throw new Error(`鏈 ${chain.id} 的 ${a.name} 與 ${b.name} 重疊`);
      const steep =
        chain.steep !== undefined &&
        ((chain.steep[0] === a.name && chain.steep[1] === b.name) ||
          (chain.steep[0] === b.name && chain.steep[1] === a.name));
      const rise = b.elevation - a.elevation;
      const length = Math.abs(rise) / (steep ? STEEP_GRADE : MAX_GRADE);
      const gap = b.from - a.to;
      if (length > gap + 1e-6) {
        throw new Error(
          `${chain.id} ${a.name}→${b.name} 需 ${length.toFixed(1)} 公尺，僅有 ${gap.toFixed(1)} 公尺`,
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

/** 點到折線的距離與最近點的累積弧長。 */
export function nearestArc(points: Local[], cumulative: number[], p: Local): { distance: number; arc: number } {
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

/** 控制點之間線性內插的縱斷面。 */
export function profileOf(controls: [number, number][]): (s: number) => number {
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

export const PROFILE_NOTE =
  "軌道面依各站月台層（臺北捷運〈車站剖面相關位置圖〉；未有文獻高程者取預設樓層表）連接，" +
  "月台範圍內水平，站間坡度不超過 3%（捷運工程叢書 9 表 2-3-1）；" +
  "西門—北門間松山新店線往松山依同表註以 3.5% 下穿板南線。";

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
