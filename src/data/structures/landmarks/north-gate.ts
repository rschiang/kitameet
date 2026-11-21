/** 臺北府城北門（承恩門）：安山岩台座、紅磚城樓與單簷重脊歇山頂。 */
import type { Local } from "../../../geo/project.ts";
import type { Feature } from "../../schema.ts";
import {
  dortsFaceIn,
  minAreaRect,
  outline,
  part,
  rect,
  shift,
  type Frame,
  type PartInput,
} from "./frame.ts";

export const NORTH_GATE = "way/238316480";

/** 台座、城樓與屋頂的高度（公尺），依正立面照片以台座面寬為比例尺換算。 */
const GATE_BASE_HEIGHT = 5.6;
const GATE_CAP_HEIGHT = 0.35;
const GATE_CHAMBER_HEIGHT = 4.65;
const GATE_EAVE_THICKNESS = 0.45;
/** 門洞淨寬與起拱高（公尺）。 */
const GATE_OPENING = 3.6;
const GATE_SPRING = 3.2;
/** 圓拱以四段階梯逼近。 */
const GATE_ARCH_STEPS = 4;
/** 城樓外壁自台座內縮、屋簷自城樓外伸的距離（公尺）。 */
const GATE_CHAMBER_INSET = 0.8;
const GATE_EAVE_REACH = 1.9;

const GATE_NOTE =
  "臺北府城北門為單簷重脊歇山頂的封閉碉堡式城門（中文維基百科「臺北府城北門」條目）：" +
  "安山岩台座內開圓拱門洞、紅磚城樓外壁環包、屋頂出簷並帶燕尾翹角。" +
  "平面取自禁限建公告圖所附 1/1000 地形圖的台座輪廓，各部高度依正立面照片以台座面寬為比例尺換算，為推估值。";

export function buildNorthGate(): Feature[] {
  const base = dortsFaceIn(outline(NORTH_GATE)) ?? outline(NORTH_GATE);
  const axis = minAreaRect(base);
  const frame: Frame = { origin: axis.center, bearing: axis.bearing };
  const L = axis.length;
  const W = axis.width;
  const name = "臺北府城北門";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("north-gate", GATE_NOTE, input));
  };

  // 台座：門洞兩側的墩身、圓拱的階梯逼近，以及拱頂之上的實心段
  const half = GATE_OPENING / 2;
  const pier = L / 2 - half;
  for (const side of [-1, 1]) {
    add({
      id: `base/${side < 0 ? "west" : "east"}`,
      name: `${name} 台座`,
      polygon: rect(frame, side * (half + pier / 2), 0, pier, W),
      base: 0,
      height: GATE_BASE_HEIGHT,
    });
  }
  const radius = GATE_OPENING / 2;
  const step = radius / GATE_ARCH_STEPS;
  for (let k = 0; k < GATE_ARCH_STEPS; k++) {
    const top = GATE_SPRING + (k + 1) * step;
    // 該層頂面處的拱半寬；越往上拱越收，兩側砌體隨之加寬
    const halfOpen = Math.sqrt(Math.max(radius * radius - (top - GATE_SPRING) ** 2, 0));
    const width = half - halfOpen;
    if (width < 0.05) continue;
    for (const side of [-1, 1]) {
      add({
        id: `base/arch/${k}/${side < 0 ? "west" : "east"}`,
        name: `${name} 門洞拱圈`,
        polygon: rect(frame, side * (halfOpen + width / 2), 0, width, W),
        base: GATE_SPRING + k * step,
        height: step,
      });
    }
  }
  add({
    id: "base/crown",
    name: `${name} 門洞拱頂`,
    polygon: rect(frame, 0, 0, GATE_OPENING, W),
    base: GATE_SPRING + radius,
    height: GATE_BASE_HEIGHT - GATE_SPRING - radius,
  });
  add({
    id: "base/cap",
    name: `${name} 台座壓簷`,
    polygon: rect(frame, 0, 0, L + 0.8, W + 0.8),
    base: GATE_BASE_HEIGHT,
    height: GATE_CAP_HEIGHT,
  });

  // 城樓紅磚外壁與北面門額
  const chamberBase = GATE_BASE_HEIGHT + GATE_CAP_HEIGHT;
  const chamberL = L - 2 * GATE_CHAMBER_INSET;
  const chamberW = W - 2 * GATE_CHAMBER_INSET;
  add({
    id: "chamber",
    name: `${name} 城樓`,
    polygon: rect(frame, 0, 0, chamberL, chamberW),
    base: chamberBase,
    height: GATE_CHAMBER_HEIGHT,
  });
  add({
    id: "plaque",
    name: `${name} 門額`,
    polygon: rect(frame, 0, chamberW / 2 + 0.12, 2.4, 0.3),
    base: chamberBase + 0.65,
    height: 0.9,
  });

  // 屋頂：出挑的簷口、三段內收的斜面、正脊與燕尾翹角
  const eaveBase = chamberBase + GATE_CHAMBER_HEIGHT;
  const eaveL = chamberL + 2 * GATE_EAVE_REACH;
  const eaveW = chamberW + 2 * GATE_EAVE_REACH;
  add({
    id: "roof/eave",
    name: `${name} 屋簷`,
    polygon: rect(frame, 0, 0, eaveL, eaveW),
    base: eaveBase,
    height: GATE_EAVE_THICKNESS,
  });
  // 下緩上陡的三段斜面：閩南式屋面為凹曲，愈近正脊愈陡
  const slopes: { rise: number; length: number; width: number }[] = [
    { rise: 1.3, length: eaveL - 2.2, width: eaveW - 4.8 },
    { rise: 1.2, length: eaveL - 4.0, width: eaveW - 9.6 },
    { rise: 0.9, length: eaveL - 5.4, width: eaveW - 12.2 },
  ];
  let slopeBase = eaveBase + GATE_EAVE_THICKNESS;
  let lower = { length: eaveL, width: eaveW };
  slopes.forEach((slope, i) => {
    add({
      id: `roof/slope/${i}`,
      name: `${name} 屋面`,
      polygon: rect(frame, 0, 0, lower.length, lower.width),
      polygonTop: rect(frame, 0, 0, slope.length, Math.max(slope.width, 0.8)),
      base: slopeBase,
      height: slope.rise,
    });
    slopeBase += slope.rise;
    lower = { length: slope.length, width: Math.max(slope.width, 0.8) };
  });
  add({
    id: "roof/ridge",
    name: `${name} 正脊`,
    polygon: rect(frame, 0, 0, lower.length, 0.9),
    base: slopeBase,
    height: 0.4,
  });
  // 燕尾：正脊兩端向外上方翹起
  for (const side of [-1, 1]) {
    const along = side * (lower.length / 2 + 0.3);
    add({
      id: `roof/tail/${side < 0 ? "west" : "east"}`,
      name: `${name} 燕尾`,
      polygon: rect(frame, along, 0, 1.4, 0.8),
      polygonTop: shift(rect(frame, along, 0, 1.0, 0.5), frame, side * 1.5, 0),
      base: slopeBase - 0.1,
      height: 1.1,
    });
  }
  // 翼角：四個簷角沿對角微微上揚
  for (const sa of [-1, 1]) {
    for (const sl of [-1, 1]) {
      const along = sa * (eaveL / 2 - 0.8);
      const lateral = sl * (eaveW / 2 - 0.8);
      add({
        id: `roof/corner/${sa < 0 ? "w" : "e"}${sl < 0 ? "s" : "n"}`,
        name: `${name} 翼角`,
        polygon: rect(frame, along, lateral, 1.6, 1.6),
        polygonTop: shift(rect(frame, along, lateral, 0.9, 0.9), frame, sa * 1.0, sl * 1.0),
        base: eaveBase + GATE_EAVE_THICKNESS - 0.2,
        height: 1.0,
      });
    }
  }
  return parts;
}

export function claim(): Local[] {
  return outline(NORTH_GATE);
}
