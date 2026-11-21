/** 二二八和平紀念碑：淺水池上的方柱台座、三個以一角站立的正方體與頂部的針形鐵架。 */
import type { Local } from "../../../geo/project.ts";
import type { Feature } from "../../schema.ts";
import { minAreaRect, outline, part, point, rect, type Frame, type PartInput } from "./frame.ts";

export const PEACE_MONUMENT = "way/350328266";

/** 台階、水池與台座的高度（公尺），依正立面照片以既有輪廓的長邊為比例尺換算。 */
const STEP_RISE = 0.15;
const POOL_HEIGHT = 0.2;
const RIM_HEIGHT = 0.45;
const RIM_WIDTH = 0.6;
const PLINTH_HEIGHT = 0.6;
/** 方柱：自台座升起撐住碑體，柱頭以托座張開承接正方體的下角。 */
const PILLAR_HEIGHT = 2.9;
const PILLAR_SIDE = 0.6;
const BRACKET_HEIGHT = 0.4;
const BRACKET_SIDE = 0.95;
/** 三個正方體的下角高程（公尺）：中央一座最高，兩側各低一截，形成錯落的疊砌。 */
const CUBE_BASES = [3.1, 4.5, 2.7];
/** 正方體立起後頂、底兩角的收頭邊長（公尺）：量體不得退化為一點，取最小可見尺寸。 */
const CUBE_CORNER = 0.4;
/** 銅鐘懸於中央正方體內，自該座頂角下方起算。 */
const BELL_DROP = 1.9;
const BELL_HEIGHT = 1.3;
/** 碑頂鐵架：兩顆算盤珠狀量體的對角寬與半高，以及珠間短桿（公尺）。 */
const BEADS = [
  { width: 1.3, half: 0.8 },
  { width: 1.6, half: 0.9 },
];
const SPIRE_NECK = 0.35;
const SPIRE_SHAFT = 1.2;
/** 針形鐵架：下段自珠上張開後急收，上段收至針尖（公尺）。 */
const NEEDLE_FOOT = 0.9;
const NEEDLE_LOWER = 2.6;
const NEEDLE_UPPER = 1.2;
const NEEDLE_TIP = 0.08;
/** 球體碑：條目載碑文刻於直徑一公尺的切面，球徑略大於切面。 */
const STELE_DIAMETER = 1.1;

const MONUMENT_NOTE =
  "中央二二八紀念碑（臺北市二二八和平紀念碑）1995 年 2 月 28 日落成於二二八和平紀念公園，" +
  "由王俊雄、鄭自財、張安清、陳振豐設計（中文維基百科「中央二二八紀念碑」條目）：" +
  "基座為三個各以一角站立、沿邊相接的正方體，方柱自淺水池中的台座升起撐住碑體，" +
  "頂部疊兩顆算盤珠狀量體與拆自基隆港起重機鋼架的針形鐵架，池畔另立切面直徑一公尺的球體碑。" +
  "平面取自 OpenStreetMap way/350328266 的紀念碑輪廓。" +
  "條目未載總高，僅載競圖規定高度不得超過 24 公尺；此處以輪廓長邊約為正方體邊長的三倍推得邊長約 5.2 公尺，" +
  "正方體以一角站立後高為邊長的 √3 倍即約 9 公尺，加上柱高與碑頂鐵架得總高約 22 公尺，合於該上限。" +
  "兩座鏤空的框狀正方體以實體量體近似，正方體的六邊形水平斷面改以等面積的正方形放樣，各部高度為推估值。";

export function buildPeaceMonument(): Feature[] {
  const ring = outline(PEACE_MONUMENT);
  const axis = minAreaRect(ring);
  const frame: Frame = { origin: axis.center, bearing: axis.bearing };
  const L = axis.length;
  const W = axis.width;
  const name = "二二八和平紀念碑";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("peace-monument", MONUMENT_NOTE, input));
  };

  // 外圈兩階收至園路，階上為鋪南非黑石的淺水池
  add({
    id: "base/step/0",
    name: `${name} 台階`,
    polygon: rect(frame, 0, 0, L * 1.5, W * 1.5),
    base: 0,
    height: STEP_RISE,
  });
  add({
    id: "base/step/1",
    name: `${name} 台階`,
    polygon: rect(frame, 0, 0, L * 1.32, W * 1.32),
    base: 0,
    height: STEP_RISE * 2,
  });
  const poolL = L * 1.12;
  const poolW = W * 1.12;
  add({
    id: "base/pool",
    name: `${name} 淺水池`,
    polygon: rect(frame, 0, 0, poolL, poolW),
    base: 0,
    height: POOL_HEIGHT,
  });
  // 池緣：四道矮牆圍住水池，流水自四旁流向碑體中心
  let rimIndex = 0;
  for (const side of [-1, 1]) {
    add({
      id: `base/rim/${rimIndex++}`,
      name: `${name} 池緣`,
      polygon: rect(
        frame,
        0,
        (side * (poolW + RIM_WIDTH)) / 2,
        poolL + RIM_WIDTH * 2,
        RIM_WIDTH,
      ),
      base: 0,
      height: RIM_HEIGHT,
    });
    add({
      id: `base/rim/${rimIndex++}`,
      name: `${name} 池緣`,
      polygon: rect(
        frame,
        (side * (poolL + RIM_WIDTH)) / 2,
        0,
        RIM_WIDTH,
        poolW + RIM_WIDTH * 2,
      ),
      base: 0,
      height: RIM_HEIGHT,
    });
  }
  add({
    id: "base/plinth",
    name: `${name} 碑體台座`,
    polygon: rect(frame, 0, 0, L * 0.78, W * 0.78),
    base: 0,
    height: PLINTH_HEIGHT,
  });

  // 四根方柱微微收分，柱頭以托座張開承接正方體的下角
  const pillarTop = PLINTH_HEIGHT + PILLAR_HEIGHT;
  let pillarIndex = 0;
  for (const sa of [-1, 1]) {
    for (const sl of [-1, 1]) {
      const along = sa * L * 0.3;
      const lateral = sl * W * 0.27;
      add({
        id: `pillar/${pillarIndex}`,
        name: `${name} 方柱`,
        polygon: rect(frame, along, lateral, PILLAR_SIDE, PILLAR_SIDE),
        polygonTop: rect(frame, along, lateral, PILLAR_SIDE * 0.8, PILLAR_SIDE * 0.8),
        base: PLINTH_HEIGHT,
        height: PILLAR_HEIGHT,
      });
      add({
        id: `pillar/${pillarIndex}/bracket`,
        name: `${name} 柱頭托座`,
        polygon: rect(frame, along, lateral, PILLAR_SIDE * 0.8, PILLAR_SIDE * 0.8),
        polygonTop: rect(frame, along, lateral, BRACKET_SIDE, BRACKET_SIDE),
        base: pillarTop,
        height: BRACKET_HEIGHT,
      });
      pillarIndex++;
    }
  }

  // 三個正方體：沿輪廓長邊一字相接，各以一角站立，故斷面較輪廓轉 45 度
  const edge = L / 3;
  const cubeRise = edge * Math.sqrt(3);
  const cubeWaist = edge * Math.pow(3, 0.25);
  const cubeFrames: Frame[] = CUBE_BASES.map((_, i) => ({
    origin: point(frame, (i - 1) * edge * 0.95, (i === 1 ? 1 : -1) * W * 0.1),
    bearing: axis.bearing + 45,
  }));
  CUBE_BASES.forEach((cubeBase, i) => {
    const diag = cubeFrames[i];
    add({
      id: `cube/${i}/lower`,
      name: `${name} 正方體`,
      polygon: rect(diag, 0, 0, CUBE_CORNER, CUBE_CORNER),
      polygonTop: rect(diag, 0, 0, cubeWaist, cubeWaist),
      base: cubeBase,
      height: cubeRise / 2,
    });
    add({
      id: `cube/${i}/upper`,
      name: `${name} 正方體`,
      polygon: rect(diag, 0, 0, cubeWaist, cubeWaist),
      polygonTop: rect(diag, 0, 0, CUBE_CORNER, CUBE_CORNER),
      base: cubeBase + cubeRise / 2,
      height: cubeRise / 2,
    });
  });

  // 碑頂：銅鐘懸於中央正方體內，其上為兩顆算盤珠與針形鐵架
  const crest = cubeFrames[1];
  const crestTop = CUBE_BASES[1] + cubeRise;
  add({
    id: "crest/bell",
    name: `${name} 銅鐘`,
    polygon: rect(crest, 0, 0, STELE_DIAMETER * 0.5, STELE_DIAMETER * 0.5),
    polygonTop: rect(crest, 0, 0, STELE_DIAMETER * 0.9, STELE_DIAMETER * 0.9),
    base: crestTop - BELL_DROP,
    height: BELL_HEIGHT,
  });
  let top = crestTop;
  BEADS.forEach((bead, i) => {
    if (i > 0) {
      add({
        id: `crest/shaft/${i}`,
        name: `${name} 碑頂短桿`,
        polygon: rect(crest, 0, 0, SPIRE_NECK * 1.15, SPIRE_NECK * 1.15),
        polygonTop: rect(crest, 0, 0, SPIRE_NECK, SPIRE_NECK),
        base: top,
        height: SPIRE_SHAFT,
      });
      top += SPIRE_SHAFT;
    }
    add({
      id: `crest/bead/${i}/lower`,
      name: `${name} 碑頂算珠`,
      polygon: rect(crest, 0, 0, SPIRE_NECK, SPIRE_NECK),
      polygonTop: rect(crest, 0, 0, bead.width, bead.width),
      base: top,
      height: bead.half,
    });
    add({
      id: `crest/bead/${i}/upper`,
      name: `${name} 碑頂算珠`,
      polygon: rect(crest, 0, 0, bead.width, bead.width),
      polygonTop: rect(crest, 0, 0, SPIRE_NECK, SPIRE_NECK),
      base: top + bead.half,
      height: bead.half,
    });
    top += bead.half * 2;
  });
  add({
    id: "crest/needle/lower",
    name: `${name} 針形鐵架`,
    polygon: rect(crest, 0, 0, NEEDLE_FOOT, NEEDLE_FOOT),
    polygonTop: rect(crest, 0, 0, SPIRE_NECK, SPIRE_NECK),
    base: top,
    height: NEEDLE_LOWER,
  });
  add({
    id: "crest/needle/upper",
    name: `${name} 針形鐵架`,
    polygon: rect(crest, 0, 0, SPIRE_NECK, SPIRE_NECK),
    polygonTop: rect(crest, 0, 0, NEEDLE_TIP, NEEDLE_TIP),
    base: top + NEEDLE_LOWER,
    height: NEEDLE_UPPER,
  });

  // 球體碑：以三段水平切片近似球面，最上一段為刻碑文的切面
  const steleAlong = -L * 0.3;
  const steleLateral = -W * 0.34;
  const stele: { id: string; lower: number; upper: number; height: number }[] = [
    { id: "lower", lower: STELE_DIAMETER * 0.4, upper: STELE_DIAMETER, height: STELE_DIAMETER * 0.45 },
    { id: "middle", lower: STELE_DIAMETER, upper: STELE_DIAMETER, height: STELE_DIAMETER * 0.3 },
    { id: "cut", lower: STELE_DIAMETER, upper: STELE_DIAMETER * 0.85, height: STELE_DIAMETER * 0.4 },
  ];
  let steleBase = POOL_HEIGHT;
  for (const slice of stele) {
    add({
      id: `stele/${slice.id}`,
      name: `${name} 球體碑`,
      polygon: rect(frame, steleAlong, steleLateral, slice.lower, slice.lower),
      polygonTop: rect(frame, steleAlong, steleLateral, slice.upper, slice.upper),
      base: steleBase,
      height: slice.height,
    });
    steleBase += slice.height;
  }
  return parts;
}

export function claim(): Local[] {
  return outline(PEACE_MONUMENT);
}
