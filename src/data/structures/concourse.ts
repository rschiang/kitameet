/**
 * 臺北車站 B1 的動線：站體環廊、捷運連通道、階梯、電扶梯、電梯與付費區，
 * 另含月台層下方的 B3 共用穿堂、捷運板南線大廳北側延伸段，以及捷運站內依資訊圖配置的梯組。
 *
 * 平面取自 OSM 的室內圖資（`osm/indoor.json`）；哪些通道屬於哪一層、階梯兩端各接到哪裡，
 * 則依站內張貼的兩份地下一層平面圖核對。樓層分四階：站體 B1 最高、捷運 B1 次之、
 * K 區再次、Z 區與 Y 區地下街最低，高程一律取 `levels.ts` 的樓層表。
 */
import { clipPolygonToRing, splitPolylineByRing } from "../../geo/clip.ts";
import {
  advance,
  convexHull,
  decompose,
  distanceToPolygon,
  nearestOnPolyline,
  pointInPolygon,
  polygonArea,
  polygonAxis,
  polygonCentroid,
} from "../../geo/measure.ts";
import { corridorPolygon } from "../../geo/offset.ts";
import type { Local } from "../../geo/project.ts";
import indoorJson from "../osm/indoor.json";
import surfaceJson from "../osm/surface.json";
import undergroundJson from "../osm/underground.json";
import type { IndoorDataset, IndoorFeature, OsmDataset } from "../osm-types.ts";
import { STRUCTURES, levelOf, railLevelOf, type StructureId } from "../levels.ts";
import { OVERRIDES } from "../overrides.ts";
import {
  GROUND_EL,
  PARKING_FLOOR_THICKNESS,
  PLATFORM_RISE,
  SLAB_THICKNESS,
  atGround,
  type Feature,
  type LevelId,
} from "../schema.ts";

const indoor = indoorJson as unknown as IndoorDataset;
const underground = undergroundJson as unknown as OsmDataset;
const surface = surfaceJson as unknown as OsmDataset;

const STATION_OUTLINE = "way/23641610";
const WEST_PARKING = "way/204616541";

const FOOTPRINT_NOTE =
  "外牆範圍描自網路資料的地下一層平面圖，以禁限建公告圖的板南線、淡水信義線車站箱涵套合（0.373 公尺／像素，殘差約 2 公尺）。" +
  "南北寬 130.8 公尺、西停車場東牆至東端 349 公尺，與《工藝精進》第 30 頁所載第 1 標範圍（東西約 350 公尺、南北約 130 公尺）相符。";

/**
 * 站體 B1 的外牆範圍（局部公尺座標，逆時針）：西停車場西牆至東停車場東牆，
 * 東北角內縮一階、東南角為斜切。
 */
export const STATION_B1_FOOTPRINT: Local[] = [
  [-232.3, -33.8],
  [165.4, -107.6],
  [223.2, -68.0],
  [236.2, 2.0],
  [165.4, 15.2],
  [167.2, 25.1],
  [-208.4, 94.8],
];

/** 東停車場的範圍：站體 B1 外牆範圍中，東區付費區東側梯廳以東的部分。 */
const EAST_PARKING_FOOTPRINT: Local[] = [
  [82.4, -92.2],
  [165.4, -107.6],
  [223.2, -68.0],
  [236.2, 2.0],
  [165.4, 15.2],
  [167.2, 25.1],
  [98.0, 37.9],
];
const MALLS = [
  { outline: "way/450732441", structure: "mall-k" },
  { outline: "way/328691510", structure: "mall-z" },
  { outline: "way/450732440", structure: "mall-y" },
  { outline: "way/450732442", structure: "mall-r" },
] as const satisfies readonly { outline: string; structure: StructureId }[];

type Tier = "station" | "metro" | "mall";

/** 各階通道的寬度（公尺）：OSM 只有中心線，寬度依平面圖的比例推估。 */
const CORRIDOR_WIDTH: Record<Tier, number> = { station: 12, metro: 8, mall: 6 };
/** 通道量體的高度（公尺）；與地下街 3.0、付費區 3.5 錯開，頂面不共面。 */
const PASSAGE_HEIGHT = 2.8;
const PAID_AREA_HEIGHT = 3.5;
const STAIR_WIDTH = 3;
const ESCALATOR_WIDTH = 2;
const ELEVATOR_SIZE = 3;
/** 階梯端點未與通道共用節點時，改接此距離內最近的通道（公尺）。 */
const SNAP = 6;
/** 電梯取此距離內的通道樓層為停靠層（公尺）。 */
const ELEVATOR_REACH = 20;
/** 出入口編號歸給此距離內最近的出地面階梯（公尺）。 */
const EXIT_REACH = 10;
/** 兩端高差不足此值的階梯視為平面通道（公尺）。 */
const MIN_RISE = 0.3;

const NOTE =
  "平面取自 OpenStreetMap 室內圖資；存在與否、連通關係與樓層高差依站內張貼的《台北車站周邊地下街 B1 出口資訊》與《台北車站地下一層平面圖》核對。寬度與高程為推估值。";

const TIER_STRUCTURE: Record<Tier, StructureId | undefined> = {
  station: "tra-hsr-station",
  metro: "metro-station",
  mall: undefined,
};
const TIER_NAME: Record<Tier, string> = {
  station: "臺北車站 B1 通道",
  metro: "捷運台北車站 B1 連通道",
  mall: "地下街連通道",
};

const POLYGONS = new Map<string, Local[]>(
  underground.features.flatMap((f) => (f.polygon ? [[f.id, f.polygon] as const] : [])),
);

function outline(id: string): Local[] {
  const polygon = POLYGONS.get(id);
  if (!polygon) throw new Error(`找不到 OSM 輪廓 ${id}`);
  return polygon;
}

/** 已由 OSM 基礎流程畫出的 way：通道不重複產生，只用來判定樓層。 */
const DRAWN_ELSEWHERE = new Set(
  [...underground.features, ...surface.features]
    .filter((f) => OVERRIDES[f.id]?.exclude !== true)
    .map((f) => f.id),
);

/** OSM 的 `level` 字串所含的樓層值：`-1;0`、`-2--1`、`-1-0` 皆可。 */
function osmLevels(raw: string | undefined): number[] {
  return (raw ?? "").match(/(?<!\d)-?\d+(\.\d+)?/g)?.map(Number) ?? [];
}

const key = (p: Local): string => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;

interface Corridor {
  id: string;
  name?: string;
  points: Local[];
  tier: Tier;
  floor: number;
}

interface Network {
  corridors: Corridor[];
  /** 頂點座標鍵對應到經過該頂點的通道樓板高程。 */
  floorsAt: Map<string, number[]>;
  floors: { station: number; metro: number };
  station: Local[];
}

/**
 * 地下街層通道的樓板：各地下街的 B1 並不等高，取各頂點到輪廓的平均距離最小的那一座地下街。
 */
function mallFloor(points: Local[]): number {
  let best: { distance: number; floor: number } | undefined;
  for (const mall of MALLS) {
    const polygon = outline(mall.outline);
    const distance =
      points.reduce((sum, p) => sum + distanceToPolygon(p, polygon), 0) / points.length;
    if (!best || distance < best.distance) {
      best = { distance, floor: levelOf(mall.structure, "B1").floor };
    }
  }
  if (!best) throw new Error("沒有可供判定樓板的地下街輪廓");
  return best.floor;
}

let cachedNetwork: Network | undefined;

/** 通道分階：level −2 為地下街；level −1 與站體環廊相連者屬站體，其餘屬捷運。 */
function network(): Network {
  if (cachedNetwork) return cachedNetwork;
  const station = outline(STATION_OUTLINE);
  const floors = {
    station: levelOf("tra-hsr-station", "B1").floor,
    metro: levelOf("metro-station", "B1").floor,
  };

  const raw = indoor.features.flatMap((f) => {
    if (f.kind !== "corridor" || !f.polyline) return [];
    const levels = osmLevels(f.tags.level);
    if (levels.length !== 1 || (levels[0] !== -1 && levels[0] !== -2)) return [];
    return [{ feature: f, points: f.polyline, level: levels[0] }];
  });

  // 以共用頂點把 level −1 的通道連成連通分量
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let root = k;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    parent.set(k, root);
    return root;
  };
  const upper = raw.filter((c) => c.level === -1);
  for (const c of upper) {
    for (const p of c.points) if (!parent.has(key(p))) parent.set(key(p), key(p));
    const first = find(key(c.points[0]));
    for (const p of c.points) parent.set(find(key(p)), first);
  }

  // 環廊所在的分量：含離站體輪廓形心最近的那條通道
  const centre = polygonCentroid(station);
  let nearest: { distance: number; root: string } | undefined;
  for (const c of upper) {
    const distance = nearestOnPolyline(centre, c.points).distance;
    if (!nearest || distance < nearest.distance) {
      nearest = { distance, root: find(key(c.points[0])) };
    }
  }
  if (!nearest) throw new Error("找不到站體 B1 環廊");
  const ring = nearest.root;

  const corridors = raw.map(({ feature, points, level }): Corridor => {
    const tier: Tier = level === -2 ? "mall" : find(key(points[0])) === ring ? "station" : "metro";
    const corridor: Corridor = {
      id: feature.id,
      points,
      tier,
      floor: tier === "mall" ? mallFloor(points) : floors[tier],
    };
    if (feature.tags.name !== undefined) corridor.name = feature.tags.name;
    return corridor;
  });

  const floorsAt = new Map<string, number[]>();
  for (const c of corridors) {
    for (const p of c.points) {
      const list = floorsAt.get(key(p));
      if (list) list.push(c.floor);
      else floorsAt.set(key(p), [c.floor]);
    }
  }

  cachedNetwork = { corridors, floorsAt, floors, station };
  return cachedNetwork;
}

const common = {
  level: "B1",
  layer: "passage",
  confidence: "estimated",
  status: "existing",
  sourceNote: NOTE,
} as const;

/** 折線在重複經過的頂點前切開：封閉成圈的通道平移成帶狀時首尾會交疊。 */
function splitAtRepeats(points: Local[]): Local[][] {
  const pieces: Local[][] = [];
  const seen = new Set<string>();
  let piece: Local[] = [];
  for (const p of points) {
    if (seen.has(key(p)) && piece.length >= 2) {
      pieces.push(piece);
      piece = [piece[piece.length - 1]];
    }
    piece.push(p);
    seen.add(key(p));
  }
  if (piece.length >= 2) pieces.push(piece);
  return pieces;
}

function passage(
  id: string,
  name: string,
  points: Local[],
  floor: number,
  width: number,
  structure: StructureId | undefined,
): Feature {
  const feature: Feature = {
    ...common,
    id,
    kind: "passage",
    name,
    geometry: { polyline: points },
    base: floor,
    height: PASSAGE_HEIGHT,
    width,
  };
  if (structure !== undefined) feature.structure = structure;
  return feature;
}

function corridorFeatures(net: Network): Feature[] {
  const malls = MALLS.map((mall) => outline(mall.outline));
  const features: Feature[] = [];
  for (const c of net.corridors) {
    if (DRAWN_ELSEWHERE.has(c.id)) continue;
    // 整條落在地下街輪廓內的通道已由地下街量體呈現
    if (malls.some((mall) => c.points.every((p) => pointInPolygon(p, mall)))) continue;
    splitAtRepeats(c.points).forEach((piece, n) => {
      features.push(
        passage(
          `indoor/${c.id}${n === 0 ? "" : `/${n + 1}`}`,
          c.name ?? TIER_NAME[c.tier],
          piece,
          c.floor,
          CORRIDOR_WIDTH[c.tier],
          TIER_STRUCTURE[c.tier],
        ),
      );
    });
  }
  return features;
}

/** B3 共用穿堂直通月台層的電扶梯：OSM 標為 highway=pedestrian 加 conveying，只標 level −3。 */
function b3PlatformEscalators(): IndoorFeature[] {
  const found = indoor.features.filter((f) => {
    const levels = osmLevels(f.tags.level);
    return (
      f.kind === "steps" &&
      f.polyline !== undefined &&
      f.tags.highway === "pedestrian" &&
      f.tags.conveying !== undefined &&
      levels.length === 1 &&
      levels[0] === -3
    );
  });
  if (found.length !== 4) throw new Error(`B3 月台電扶梯應為 4 座，實得 ${found.length} 座`);
  return found;
}

/**
 * 階梯與電扶梯：依 `incline` 定出低端與高端，再決定兩端各接到哪一層。
 * 端點與通道共用節點時取該通道的樓板；否則依 `level` 標籤判斷通往捷運月台層或地面，
 * 最後才改接鄰近的通道。兩端都定不出高程的階梯捨棄，不臆測。
 * 月台層下方的 B3 共用穿堂電扶梯另行處理：自 B3 樓板直上月台面。
 */
function stepFeatures(net: Network): Feature[] {
  const platformTop = railLevelOf("tra-hsr-station", "B2") + PLATFORM_RISE;
  const metroB3 = levelOf("metro-station-r", "B3").floor;
  const stationB3 = levelOf("tra-hsr-station", "B3").floor;
  const fromB3 = new Set(b3PlatformEscalators().map((f) => f.id));
  const shared = (p: Local): number[] => net.floorsAt.get(key(p)) ?? [];
  const snap = (p: Local): number | null => {
    let best: { distance: number; floor: number } | undefined;
    for (const c of net.corridors) {
      const distance = nearestOnPolyline(p, c.points).distance;
      if (distance < SNAP && (!best || distance < best.distance)) best = { distance, floor: c.floor };
    }
    return best ? best.floor : null;
  };

  const features: Feature[] = [];
  for (const f of indoor.features) {
    if (f.kind !== "steps" || !f.polyline) continue;
    const levels = osmLevels(f.tags.level);
    if (levels.length === 0 || levels.every((l) => l >= 0)) continue;
    const incline = f.tags.incline;
    if (incline !== "up" && incline !== "down") continue;

    const points = incline === "up" ? f.polyline : [...f.polyline].reverse();
    const lo = points[0];
    const hi = points[points.length - 1];
    const sharedLo = shared(lo);
    const sharedHi = shared(hi);
    const deepest = Math.min(...levels);
    const highest = Math.max(...levels);
    const middle: Local = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];

    let lower: number | null;
    let upper: number | null;
    if (fromB3.has(f.id)) {
      // 月台層下方的共用穿堂直通月台面
      lower = stationB3;
      upper = platformTop;
    } else if (
      sharedLo.length === 0 &&
      sharedHi.length === 0 &&
      levels.length === 2 &&
      deepest === -2 &&
      highest === -1 &&
      pointInPolygon(middle, net.station)
    ) {
      // 月台階梯：站體內、兩端皆不接通道，自月台面上到穿堂層
      lower = platformTop;
      upper = net.floors.station;
    } else {
      lower = sharedLo.length > 0 ? Math.min(...sharedLo) : deepest <= -3 ? metroB3 : snap(lo);
      upper = sharedHi.length > 0 ? Math.max(...sharedHi) : highest >= 0 ? GROUND_EL : snap(hi);
    }
    if (lower === null || upper === null) continue;

    const id = `indoor/${f.id}`;
    if (upper - lower < MIN_RISE) {
      features.push(passage(id, "通道", points, lower, STAIR_WIDTH, undefined));
      continue;
    }
    const escalator = f.tags.conveying !== undefined && f.tags.conveying !== "no";
    const feature: Feature = {
      ...common,
      id,
      kind: escalator ? "escalator" : "stairs",
      name: escalator ? "電扶梯" : "階梯",
      geometry: { polyline: points },
      base: lower,
      baseEnd: upper,
      height: SLAB_THICKNESS,
      width: escalator ? ESCALATOR_WIDTH : STAIR_WIDTH,
    };
    // 量體所屬樓層取低端：B3 穿堂的電扶梯與 B1 的動線分屬兩層薄板
    if (fromB3.has(f.id)) feature.level = "B3";
    features.push(feature);
  }
  return features;
}

/** 出入口編號歸給最近的出地面階梯；附近沒有已繪階梯的出入口不產生量體。 */
function nameExits(stairs: Feature[]): void {
  const claimed = new Map<Feature, number>();
  for (const f of indoor.features) {
    if (f.kind !== "entrance" || !f.point || f.tags.ref === undefined) continue;
    let best: { distance: number; stair: Feature } | undefined;
    for (const stair of stairs) {
      const line = stair.geometry.polyline;
      if (!atGround(stair.baseEnd) || !line) continue;
      const top = line[line.length - 1];
      const distance = Math.hypot(top[0] - f.point[0], top[1] - f.point[1]);
      if (distance <= EXIT_REACH && (!best || distance < best.distance)) best = { distance, stair };
    }
    if (!best || best.distance >= (claimed.get(best.stair) ?? Infinity)) continue;
    claimed.set(best.stair, best.distance);
    best.stair.name = `出口 ${f.tags.ref}`;
  }
}

function elevatorFeatures(net: Network): Feature[] {
  const platformTop = railLevelOf("tra-hsr-station", "B2") + PLATFORM_RISE;
  const features: Feature[] = [];
  for (const f of indoor.features) {
    if (f.kind !== "elevator" || !f.point) continue;
    const levels = osmLevels(f.tags.level);
    if (levels.length > 0 && levels.every((l) => l >= 0)) continue;
    const reachesGround = levels.length === 0 || levels.some((l) => l >= 0);

    let bottom: number;
    let top: number;
    if (levels.length > 0 && Math.min(...levels) <= -2 && pointInPolygon(f.point, net.station)) {
      // 站體內通往月台的電梯
      bottom = platformTop;
      top = reachesGround ? GROUND_EL : net.floors.station;
    } else {
      const candidates = net.corridors
        .filter((c) => nearestOnPolyline(f.point as Local, c.points).distance <= ELEVATOR_REACH)
        .map((c) => c.floor);
      if (candidates.length === 0) continue;
      const mall = MALLS.find((m) => pointInPolygon(f.point as Local, outline(m.outline)));
      const parking = mall ? STRUCTURES[mall.structure].levels.B2 : undefined;
      // 地下街內標到 level −3 的電梯通到地下街下方的停車場層（OSM 的 K 區停車場標 layer −3）
      bottom = Math.min(...levels) <= -3 && parking ? parking.floor : Math.min(...candidates);
      top = reachesGround ? GROUND_EL : Math.max(...candidates);
    }
    if (top - bottom < MIN_RISE) continue;

    const [x, y] = f.point;
    const half = ELEVATOR_SIZE / 2;
    features.push({
      ...common,
      id: `indoor/${f.id}`,
      kind: "elevator",
      name: f.tags.ref === undefined ? "電梯" : `電梯 ${f.tags.ref}`,
      geometry: {
        polygon: [
          [x - half, y - half],
          [x + half, y - half],
          [x + half, y + half],
          [x - half, y + half],
        ],
      },
      base: bottom,
      height: top - bottom,
    });
  }
  return features;
}

/**
 * 付費區：兩份平面圖皆繪出各區北半為臺鐵、南半為高鐵，與下層月台的配置一致；
 * OSM 把西北區標為高鐵，不採用。
 */
function paidAreaFeatures(net: Network): Feature[] {
  const axis = polygonAxis(net.station);
  return indoor.features.flatMap((f): Feature[] => {
    if (f.kind !== "room" || !f.polygon) return [];
    const north = decompose(axis.center, axis.bearing, polygonCentroid(f.polygon)).lateral > 0;
    return [
      {
        ...common,
        id: `indoor/${f.id}`,
        kind: "station",
        name: north ? "臺鐵 B1 付費區" : "高鐵 B1 付費區",
        structure: "tra-hsr-station",
        line: north ? "tra" : "hsr",
        geometry: { polygon: f.polygon },
        base: net.floors.station,
        height: PAID_AREA_HEIGHT,
      },
    ];
  });
}

function westParkingPolygon(): Local[] {
  const parking = indoor.features.find(
    (f: IndoorFeature) => f.kind === "parking" && f.id === WEST_PARKING,
  );
  if (!parking?.polygon) throw new Error(`找不到西停車場輪廓 ${WEST_PARKING}`);
  return parking.polygon;
}

function westParkingFeature(): Feature {
  const info = levelOf("parking-west", "B1");
  return {
    id: "station/parking/west",
    kind: "parking",
    name: "臺北車站西地下停車場",
    level: "B1",
    structure: "parking-west",
    layer: "mall",
    geometry: { polygon: westParkingPolygon() },
    base: info.floor,
    height: PARKING_FLOOR_THICKNESS,
    confidence: "estimated",
    sourceNote:
      "站內兩份地下一層平面圖皆繪出環廊西半圈內的西停車場；平面沿用 OSM 同一街廓的地面停車場輪廓（way/204616541），為推估。",
    status: "existing",
  };
}

function eastParkingFeature(): Feature {
  const info = levelOf("parking-east", "B1");
  return {
    id: "station/parking/east",
    kind: "parking",
    name: "臺北車站東地下停車場",
    level: "B1",
    structure: "parking-east",
    layer: "mall",
    geometry: { polygon: EAST_PARKING_FOOTPRINT },
    base: info.floor,
    height: PARKING_FLOOR_THICKNESS,
    confidence: "estimated",
    sourceNote: FOOTPRINT_NOTE,
    status: "existing",
  };
}

/** 臺北車站 B1 的動線量體。 */
export function buildConcourse(): Feature[] {
  const net = network();
  const steps = stepFeatures(net);
  nameExits(steps);
  return [
    ...corridorFeatures(net),
    ...steps,
    ...elevatorFeatures(net),
    ...paidAreaFeatures(net),
    westParkingFeature(),
    eastParkingFeature(),
  ];
}

/** B3 共用穿堂的範圍：四座月台電扶梯各取此寬度的帶狀後求凸包（公尺）。 */
const B3_HALL_WIDTH = 8;
/** B3 穿堂自月台電扶梯往淡水信義線箱涵延伸時的搜尋距離（公尺）。 */
const B3_HALL_REACH = 60;
/** 捷運站內梯組的坡度（度）。 */
const ESCALATOR_SLOPE = 30;
/** 梯組下端伸入月台的長度（公尺）。 */
const TRANSFER_LANDING = 2;
/** 裁出大廳北側延伸段的矩形邊長（公尺）：自月台南端往南，足以涵蓋箱涵南端。 */
const ARM_SPAN = 120;
/** 同一梯組內相鄰兩道的淨距（公尺）。 */
const LANE_GAP = 0.5;
/** 板南線四組月台梯組的中心位置：自月台中點沿主軸的距離，以月台長度為 1（資訊圖 B3 量得 0.168、0.393、0.617、0.843，電梯居中）。 */
const BANNAN_BANKS = [-0.34, -0.11, 0.11, 0.34];

type LaneKind = "escalator" | "stairs";
const LANE_WIDTH: Record<LaneKind, number> = { escalator: ESCALATOR_WIDTH, stairs: STAIR_WIDTH };
const LANE_NAME: Record<LaneKind, string> = { escalator: "電扶梯", stairs: "階梯" };

const B3_NOTE =
  "〈台北車站資訊圖〉B3：淡水信義線大廳層西側與臺鐵、高鐵的 B3 轉乘區相連。" +
  "平面取 OSM 月台層電扶梯 way/748819891、748819892、748819894、748819895 各 8 公尺寬的帶狀，" +
  "延伸到公告圖的淡水信義線車站箱涵後求凸包；範圍與高程為推估。";

const METRO_PLAN_NOTE =
  "臺北捷運〈台北車站資訊圖〉BL12R10-SW(26.05)：梯組的數量、每組的電扶梯與階梯道數、相對位置與上下行方向依資訊圖；" +
  "資訊圖為示意圖，平面沿 OSM 月台主軸配置，坡度 30 度，位置與尺寸為推估。";

/** 自 `from` 往 `to` 的方位（度，自正東起算）。 */
const bearingBetween = (from: Local, to: Local): number =>
  (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;

const bankWidth = (lanes: LaneKind[]): number =>
  lanes.reduce((sum, lane) => sum + LANE_WIDTH[lane], 0) + LANE_GAP * (lanes.length - 1);

/**
 * 一組並排的電扶梯與階梯。`foot`、`top` 為整組中心線的下端與上端；
 * `lanes` 自上行方向的左側排到右側，各道的 id 為 `<id>/<kind>/<同類序號>`。
 */
function bank(spec: {
  id: string;
  name: string;
  lanes: LaneKind[];
  foot: Local;
  top: Local;
  base: number;
  baseEnd: number;
  level: LevelId;
}): Feature[] {
  const bearing = bearingBetween(spec.foot, spec.top);
  const width = bankWidth(spec.lanes);
  const count: Record<LaneKind, number> = { escalator: 0, stairs: 0 };
  let used = 0;
  return spec.lanes.map((kind): Feature => {
    const offset = width / 2 - used - LANE_WIDTH[kind] / 2;
    used += LANE_WIDTH[kind] + LANE_GAP;
    count[kind] += 1;
    return {
      id: `${spec.id}/${kind}/${count[kind]}`,
      kind,
      name: `${spec.name}${LANE_NAME[kind]}`,
      level: spec.level,
      structure: "metro-station",
      layer: "passage",
      geometry: {
        polyline: [
          advance(spec.foot, bearing + 90, offset),
          advance(spec.top, bearing + 90, offset),
        ],
      },
      base: spec.base,
      baseEnd: spec.baseEnd,
      height: SLAB_THICKNESS,
      width: LANE_WIDTH[kind],
      confidence: "estimated",
      status: "existing",
      sourceNote: METRO_PLAN_NOTE,
    };
  });
}

/**
 * 臺鐵、高鐵月台層下方的 B3 共用穿堂：淡水信義線大廳層往西凸出的轉乘區。
 * `tamsuiBox` 為公告圖的淡水信義線車站箱涵，穿堂自月台電扶梯延伸到其環上。
 */
export function buildB3Concourse(tamsuiBox: Local[]): Feature[] {
  const hallLevel = levelOf("tra-hsr-station", "B3");
  const ring = [...tamsuiBox, tamsuiBox[0]];
  const hall = convexHull(
    b3PlatformEscalators().flatMap((f) => {
      const line = f.polyline as Local[];
      const a = line[0];
      const b = line[line.length - 1];
      const [near, far] =
        nearestOnPolyline(a, ring).distance <= nearestOnPolyline(b, ring).distance ? [a, b] : [b, a];
      const band = corridorPolygon(line, B3_HALL_WIDTH);
      if (pointInPolygon(near, tamsuiBox)) return [...band, near];
      // 電扶梯靠箱涵的一端沿自身方向延伸，取第一個碰到箱涵環的點
      const reach = splitPolylineByRing(
        [near, advance(near, bearingBetween(far, near), B3_HALL_REACH)],
        tamsuiBox,
      );
      if (reach.inside.length === 0) {
        throw new Error(`B3 月台電扶梯 ${f.id} 延伸 ${B3_HALL_REACH} 公尺仍未抵達淡水信義線車站箱涵`);
      }
      const outside = reach.outside[0];
      return [...band, outside[outside.length - 1]];
    }),
  );

  return [
    {
      id: "station/concourse/B3",
      kind: "station",
      name: "臺鐵高鐵捷運共用 B3 穿堂",
      level: "B3",
      structure: "tra-hsr-station",
      layer: "passage",
      geometry: { polygon: hall },
      base: hallLevel.floor,
      height: hallLevel.height,
      confidence: "estimated",
      sourceNote: B3_NOTE,
      status: "existing",
    },
  ];
}

/** 捷運板南線大廳層北側延伸段，以及延伸段中段通往淡水信義線月台層、北端通往大廳層的梯組。 */
export function buildMetroTransfer(
  bannanBox: Local[],
  tamsuiBox: Local[],
  tamsuiPlatform: Local[],
): Feature[] {
  const axis = polygonAxis(tamsuiPlatform);
  const bannanRing = [...bannanBox, bannanBox[0]];
  const westIsSouth =
    nearestOnPolyline(axis.west, bannanRing).distance <
    nearestOnPolyline(axis.east, bannanRing).distance;
  const end = westIsSouth ? axis.west : axis.east;
  const south = westIsSouth ? axis.bearing + 180 : axis.bearing;
  const north = south + 180;
  /** 自主軸往西橫移（公尺）。 */
  const beside = (p: Local, metres: number): Local => advance(p, north + 90, metres);

  const span = [end, advance(end, south, ARM_SPAN)];
  const reach = splitPolylineByRing(span, bannanBox);
  if (reach.inside.length === 0 || reach.outside.length === 0) {
    throw new Error("淡水信義線月台主軸往南未穿入板南線車站箱涵");
  }
  const entry = reach.outside[0][reach.outside[0].length - 1];
  const armLength = Math.hypot(entry[0] - end[0], entry[1] - end[1]);

  const b2 = levelOf("metro-station", "B2");
  const b3 = levelOf("metro-station-r", "B3").floor;
  const platformTop = railLevelOf("metro-station-r", "B4") + PLATFORM_RISE;
  const tan = Math.tan((ESCALATOR_SLOPE * Math.PI) / 180);
  const runB4 = (b2.floor - platformTop) / tan;
  const runB3 = (b2.floor - b3) / tan;
  if (runB4 - TRANSFER_LANDING >= armLength) {
    throw new Error(
      `捷運 B2 大廳北側延伸段長 ${armLength.toFixed(1)} 公尺，容不下通往月台層的梯組`,
    );
  }

  // 延伸段：淡水信義線箱涵在月台南端以南的部分；裁切用的環須為逆時針
  const cutter = corridorPolygon(span, ARM_SPAN);
  if (polygonArea(cutter) < 0) cutter.reverse();
  const middle = advance(end, south, armLength / 2);
  const arm = clipPolygonToRing(tamsuiBox, cutter).find((piece) => pointInPolygon(middle, piece));
  if (!arm) throw new Error("找不到淡水信義線箱涵在月台南端以南的部分");

  const foot = advance(end, north, TRANSFER_LANDING);
  const west: LaneKind[] = ["stairs", "escalator", "escalator"];
  const east: LaneKind[] = ["escalator", "escalator"];
  // 北端兩組梯組之間留一座電梯的寬度，以主軸為中心
  const westOffset = ELEVATOR_SIZE / 2 + bankWidth(west) / 2;
  const eastOffset = -(ELEVATOR_SIZE / 2 + bankWidth(east) / 2);
  const tip = { name: "捷運 B2–B3 ", base: b3, baseEnd: b2.floor, level: "B3" } as const;

  return [
    {
      id: "metro/bannan/concourse/B2/north",
      kind: "station",
      name: "捷運板南線大廳層北側延伸段（B2）",
      level: "B2",
      structure: "metro-station",
      layer: "metro",
      line: "bl",
      geometry: { polygon: arm },
      base: b2.floor,
      height: b2.height,
      confidence: "estimated",
      status: "existing",
      sourceNote: METRO_PLAN_NOTE,
    },
    // 中段：上行往南，階梯在最東側
    ...bank({
      id: "metro/transfer/B4",
      name: "捷運 B2–B4 ",
      lanes: ["stairs", "escalator", "escalator"],
      foot,
      top: advance(foot, south, runB4),
      base: platformTop,
      baseEnd: b2.floor,
      level: "B4",
    }),
    ...bank({
      ...tip,
      id: "metro/transfer/B3/west",
      lanes: west,
      foot: beside(advance(end, north, runB3), westOffset),
      top: beside(end, westOffset),
    }),
    ...bank({
      ...tip,
      id: "metro/transfer/B3/east",
      lanes: east,
      foot: beside(advance(end, north, runB3), eastOffset),
      top: beside(end, eastOffset),
    }),
  ];
}

/**
 * 捷運板南線大廳層通往島式月台的四組梯組，每組兩道電扶梯、一道階梯，上端皆朝月台中央；
 * 自大廳層往下看，電扶梯在左側。
 */
export function buildBannanPlatformAccess(bannanPlatform: Local[]): Feature[] {
  const axis = polygonAxis(bannanPlatform);
  const platformTop = railLevelOf("metro-station", "B3") + PLATFORM_RISE;
  const b2 = levelOf("metro-station", "B2").floor;
  const run = (b2 - platformTop) / Math.tan((ESCALATOR_SLOPE * Math.PI) / 180);
  return BANNAN_BANKS.flatMap((fraction, i) => {
    const centre = advance(axis.center, axis.bearing, fraction * axis.length);
    const up = fraction < 0 ? axis.bearing : axis.bearing + 180;
    // 各道自上行方向的左側排起：電扶梯在上行的右側，即自大廳層往下看的左側
    return bank({
      id: `metro/bannan/platform/${i + 1}`,
      name: "捷運板南線月台",
      lanes: ["stairs", "escalator", "escalator"],
      foot: advance(centre, up + 180, run / 2),
      top: advance(centre, up, run / 2),
      base: platformTop,
      baseEnd: b2,
      level: "B3",
    });
  });
}
