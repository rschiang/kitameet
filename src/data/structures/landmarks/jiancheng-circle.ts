/** 建成圓環：2017 年落成的圓環廣場，環狀鋪面、中央草丘與下沉展示的防空蓄水池遺構。 */
import type { Local } from "../../../geo/project.ts";
import type { Feature } from "../../schema.ts";
import {
  insetRing,
  minAreaRect,
  outline,
  part,
  polygonCentroid,
  rect,
  type Frame,
  type PartInput,
} from "./frame.ts";

export const JIANCHENG_CIRCLE = "way/243906145";

/** 各圈自廣場外緣內縮的距離（公尺）。 */
const KERB_WIDTH = 0.5;
const SEAT_OUTER = 1.6;
const SEAT_INNER = 3.0;
const PLINTH_INSET = 6.0;
const PLINTH_EDGE_INSET = 7.0;
// 草丘內緣留出的空地須容得下遺構展示框的對角，因此止於內縮 11.8 公尺處
const MOUND_OUTER = 8.0;
const MOUND_MID = 9.2;
const MOUND_CREST_OUTER = 10.0;
const MOUND_CREST_INNER = 10.6;
const MOUND_UPPER_INNER = 11.0;
const MOUND_INNER = 11.8;

/** 各層的高程與層高（公尺），依圓環廣場現場照片以廣場直徑為比例尺推估。 */
const KERB_HEIGHT = 0.26;
const PAVING_HEIGHT = 0.12;
const SEAT_HEIGHT = 0.44;
const PLINTH_HEIGHT = 0.38;
const PLINTH_EDGE_HEIGHT = 0.5;
const MOUND_LOWER_RISE = 0.46;
const MOUND_UPPER_RISE = 0.32;
const MOUND_CAP_HEIGHT = 0.12;

/** 蓄水池遺構：文獻載直徑 11 公尺、高 2.2 公尺，展示框與玻璃罩的尺寸為推估（公尺）。 */
const CISTERN_DIAMETER = 11.0;
const CISTERN_WALL = 0.45;
const CISTERN_WALL_HEIGHT = 1.0;
const SUNKEN_FLOOR_SIDE = CISTERN_DIAMETER + 1.6;
const SUNKEN_FLOOR_HEIGHT = 0.12;
const RELIC_FRAME_SIDE = CISTERN_DIAMETER + 2.8;
const RELIC_FRAME_WIDTH = 0.6;
const RELIC_FRAME_HEIGHT = 0.46;
const RELIC_GLASS_WIDTH = 0.12;
const RELIC_GLASS_HEIGHT = 0.75;

/** 四向步道的方位，自最小外接矩形的長軸起算（度）。 */
const WALK_BEARINGS = [0, 90, 180, 270];
/** 步道寬度，以及坐階在步道處讓出的頂點數。 */
const WALK_WIDTH = 5.0;
const SEAT_GAP = 1;

const CIRCLE_NOTE =
  "建成圓環闢建於 1908 年，2016 年拆除美食館建物後於 2017 年改為圓環廣場（中文維基百科「建成圓環」條目）：" +
  "外環緣石與環狀鋪面圍住內圈台座，台座上隆起草丘，中央以下沉廣場展示 1943 年闢建的市定古蹟大稻埕圓環防空蓄水池。" +
  "平面取自 OSM 的圓環廣場綠地輪廓，各同心圈以該輪廓逐圈內縮取得，四向步道開口依最小外接矩形的兩軸放樣。" +
  "蓄水池遺構依中文維基百科「大稻埕圓環防空蓄水池」條目所載直徑 11 公尺、高 2.2 公尺放樣，池體大半低於地面，" +
  "量體僅表現露出地面的一段；草丘與遺構展示框、玻璃罩的高度依現場照片以廣場直徑為比例尺換算，為推估值。";

/** 方位最接近指定方向的頂點序號，使環帶的分段處落在四向步道上。 */
function nearestIndex(ring: Local[], centre: Local, bearingDeg: number): number {
  const target = (bearingDeg * Math.PI) / 180;
  let best = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  ring.forEach((p, i) => {
    const angle = Math.atan2(p[1] - centre[1], p[0] - centre[0]);
    // 以 atan2 取角差的主值，避免 ±180 度附近誤判
    const diff = Math.abs(Math.atan2(Math.sin(angle - target), Math.cos(angle - target)));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  });
  return best;
}

/**
 * 以兩圈同頂點數的環產生環帶的各段：每段沿外圈取一段頂點，再沿內圈反向接回。
 * `trim` 為每段兩端各讓出的頂點數，用於在四向步道處斷開坐階。
 */
function bandArcs(outer: Local[], inner: Local[], cuts: number[], trim = 0): Local[][] {
  const n = outer.length;
  const arcs: Local[][] = [];
  for (let c = 0; c < cuts.length; c++) {
    const from = cuts[c] + trim;
    const next = cuts[(c + 1) % cuts.length];
    const to = (next > cuts[c] ? next : next + n) - trim;
    if (to - from < 1) continue;
    const poly: Local[] = [];
    for (let i = from; i <= to; i++) poly.push(outer[i % n]);
    for (let i = to; i >= from; i--) poly.push(inner[i % n]);
    arcs.push(poly);
  }
  return arcs;
}

/** 方框的四條邊，供遺構展示框、池壁與玻璃罩放樣。 */
function squareFrame(
  frame: Frame,
  side: number,
  thickness: number,
): { side: string; polygon: Local[] }[] {
  const arm = side / 2 - thickness / 2;
  return [
    { side: "east", polygon: rect(frame, arm, 0, thickness, side) },
    { side: "west", polygon: rect(frame, -arm, 0, thickness, side) },
    { side: "north", polygon: rect(frame, 0, arm, side, thickness) },
    { side: "south", polygon: rect(frame, 0, -arm, side, thickness) },
  ];
}

export function buildJianchengCircle(): Feature[] {
  const ring = outline(JIANCHENG_CIRCLE);
  const axis = minAreaRect(ring);
  const frame: Frame = { origin: axis.center, bearing: axis.bearing };
  const centre = polygonCentroid(ring);
  // 四向步道的方位所對應的頂點，即各環帶的分段處
  const cuts = [
    ...new Set(WALK_BEARINGS.map((b) => nearestIndex(ring, centre, axis.bearing + b))),
  ].sort((a, b) => a - b);
  const at = (inset: number): Local[] => insetRing(ring, inset);
  const name = "建成圓環";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("jiancheng-circle", CIRCLE_NOTE, input));
  };

  // 外環緣石與其內的環狀人行鋪面
  const kerbInner = at(KERB_WIDTH);
  bandArcs(ring, kerbInner, cuts).forEach((polygon, i) => {
    add({
      id: `kerb/${i}`,
      name: `${name} 外環緣石`,
      polygon,
      base: 0,
      height: KERB_HEIGHT,
    });
  });
  add({
    id: "paving",
    name: `${name} 環狀鋪面`,
    polygon: kerbInner,
    base: 0,
    height: PAVING_HEIGHT,
  });

  // 環邊坐階：四段弧，於四向步道處斷開
  bandArcs(at(SEAT_OUTER), at(SEAT_INNER), cuts, SEAT_GAP).forEach((polygon, i) => {
    add({
      id: `seat/${i}`,
      name: `${name} 環邊坐階`,
      polygon,
      base: 0,
      height: SEAT_HEIGHT,
    });
  });

  // 四向步道開口的鋪面：自台座外緣通往環狀鋪面
  const halfLength = axis.length / 2;
  const halfWidth = axis.width / 2;
  for (const sign of [-1, 1]) {
    add({
      id: `walk/${sign < 0 ? "west" : "east"}`,
      name: `${name} 步道鋪面`,
      polygon: rect(frame, sign * (halfLength - PLINTH_INSET / 2), 0, PLINTH_INSET, WALK_WIDTH),
      base: 0,
      height: PAVING_HEIGHT + 0.04,
    });
    add({
      id: `walk/${sign < 0 ? "south" : "north"}`,
      name: `${name} 步道鋪面`,
      polygon: rect(frame, 0, sign * (halfWidth - PLINTH_INSET / 2), WALK_WIDTH, PLINTH_INSET),
      base: 0,
      height: PAVING_HEIGHT + 0.04,
    });
  }

  // 內圈台座與其壓邊
  const plinth = at(PLINTH_INSET);
  add({
    id: "plinth",
    name: `${name} 內圈台座`,
    polygon: plinth,
    base: 0,
    height: PLINTH_HEIGHT,
  });
  bandArcs(plinth, at(PLINTH_EDGE_INSET), cuts).forEach((polygon, i) => {
    add({
      id: `plinth/edge/${i}`,
      name: `${name} 台座壓邊`,
      polygon,
      base: 0,
      height: PLINTH_EDGE_HEIGHT,
    });
  });

  // 中央草丘：兩段環狀緩坡逐圈收頂，末段為平緩的丘頂
  const moundLower = bandArcs(at(MOUND_OUTER), at(MOUND_INNER), cuts);
  const moundMid = bandArcs(at(MOUND_MID), at(MOUND_UPPER_INNER), cuts);
  const moundCrest = bandArcs(at(MOUND_CREST_OUTER), at(MOUND_CREST_INNER), cuts);
  moundLower.forEach((polygon, i) => {
    add({
      id: `mound/lower/${i}`,
      name: `${name} 草丘下坡`,
      polygon,
      polygonTop: moundMid[i],
      base: PLINTH_HEIGHT,
      height: MOUND_LOWER_RISE,
    });
  });
  moundMid.forEach((polygon, i) => {
    add({
      id: `mound/upper/${i}`,
      name: `${name} 草丘上坡`,
      polygon,
      polygonTop: moundCrest[i],
      base: PLINTH_HEIGHT + MOUND_LOWER_RISE,
      height: MOUND_UPPER_RISE,
    });
  });
  moundCrest.forEach((polygon, i) => {
    add({
      id: `mound/cap/${i}`,
      name: `${name} 草丘頂面`,
      polygon,
      base: PLINTH_HEIGHT + MOUND_LOWER_RISE + MOUND_UPPER_RISE,
      height: MOUND_CAP_HEIGHT,
    });
  });

  // 蓄水池遺構：下沉展示面、紅磚池壁、展示框與其上的玻璃罩
  add({
    id: "relic/floor",
    name: `${name} 遺構下沉展示面`,
    polygon: rect(frame, 0, 0, SUNKEN_FLOOR_SIDE, SUNKEN_FLOOR_SIDE),
    base: 0,
    height: SUNKEN_FLOOR_HEIGHT,
  });
  for (const bar of squareFrame(frame, CISTERN_DIAMETER, CISTERN_WALL)) {
    add({
      id: `relic/wall/${bar.side}`,
      name: `${name} 蓄水池池壁`,
      polygon: bar.polygon,
      base: 0,
      height: CISTERN_WALL_HEIGHT,
    });
  }
  for (const bar of squareFrame(frame, RELIC_FRAME_SIDE, RELIC_FRAME_WIDTH)) {
    add({
      id: `relic/frame/${bar.side}`,
      name: `${name} 遺構展示框`,
      polygon: bar.polygon,
      base: 0,
      height: RELIC_FRAME_HEIGHT,
    });
  }
  for (const bar of squareFrame(frame, RELIC_FRAME_SIDE, RELIC_GLASS_WIDTH)) {
    add({
      id: `relic/glass/${bar.side}`,
      name: `${name} 遺構玻璃罩`,
      polygon: bar.polygon,
      base: RELIC_FRAME_HEIGHT,
      height: RELIC_GLASS_HEIGHT,
    });
  }
  return parts;
}

export function claim(): Local[] {
  return outline(JIANCHENG_CIRCLE);
}
