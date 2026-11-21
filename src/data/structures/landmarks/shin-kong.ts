/** 新光人壽保險摩天大樓（新光三越站前店）：裙樓、塔身與逐層出簷收分的塔冠。 */
import type { Local } from "../../../geo/project.ts";
import type { Feature } from "../../schema.ts";
import {
  dortsFaceIn,
  insetRing,
  minAreaRect,
  outline,
  part,
  rect,
  type Frame,
  type PartInput,
} from "./frame.ts";

export const SHIN_KONG = "way/204711206";

/** 裙樓與塔樓各段的高程（公尺）；屋頂 238.15、尖頂 244.15 取自文獻。 */
const SK_PODIUM_PLINTH = 7.0;
const SK_PODIUM_TOP = 43.0;
const SK_PODIUM_CORNICE = 46.0;
const SK_PODIUM_PARAPET = 47.5;
const SK_SHAFT_TOP = 188.0;
const SK_ROOF = 238.15;
const SK_SPIRE = 244.15;
/** 塔樓中段的機電層帶高程（公尺）。 */
const SK_BAND_LEVELS = [60, 112, 160];

const SK_NOTE =
  "新光人壽保險摩天大樓 1993 年完工，地上 51 層，屋頂 238.15 公尺、尖頂 244.15 公尺" +
  "（中文維基百科「新光人壽保險摩天大樓」條目）。裙樓為新光三越臺北站前店。" +
  "裙樓平面取自 OSM 輪廓、塔樓平面取自禁限建公告圖的房屋面（四角內凹），" +
  "塔冠逐層出簷收分的段落高程依外觀照片比例換算，為推估值。";

export function buildShinKong(): Feature[] {
  const podium = outline(SHIN_KONG);
  const tower = dortsFaceIn(podium) ?? insetRing(podium, 6);
  const axis = minAreaRect(tower);
  const frame: Frame = { origin: axis.center, bearing: axis.bearing };
  const name = "新光人壽保險摩天大樓";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("shin-kong", SK_NOTE, input));
  };

  // 裙樓：新光三越站前店
  add({
    id: "podium/plinth",
    name: `${name} 裙樓基座`,
    polygon: insetRing(podium, -0.6),
    base: 0,
    height: SK_PODIUM_PLINTH,
  });
  add({
    id: "podium/body",
    name: `${name} 裙樓`,
    polygon: podium,
    base: SK_PODIUM_PLINTH,
    height: SK_PODIUM_TOP - SK_PODIUM_PLINTH,
  });
  add({
    id: "podium/cornice",
    name: `${name} 裙樓簷口`,
    polygon: insetRing(podium, -0.9),
    base: SK_PODIUM_TOP,
    height: SK_PODIUM_CORNICE - SK_PODIUM_TOP,
  });
  add({
    id: "podium/parapet",
    name: `${name} 裙樓女兒牆`,
    polygon: insetRing(podium, 1.4),
    base: SK_PODIUM_CORNICE,
    height: SK_PODIUM_PARAPET - SK_PODIUM_CORNICE,
  });

  // 塔身與機電層帶
  add({
    id: "tower/shaft",
    name: `${name} 塔身`,
    polygon: tower,
    base: 0,
    height: SK_SHAFT_TOP,
  });
  SK_BAND_LEVELS.forEach((level, i) => {
    add({
      id: `tower/band/${i}`,
      name: `${name} 設備層`,
      polygon: insetRing(tower, -0.45),
      base: level,
      height: 2.2,
    });
  });

  // 塔冠：三層出簷收分，頂部為攢尖頂與尖塔
  const crown: { id: string; name: string; inset: number; base: number; height: number }[] = [
    { id: "crown/cornice-1", name: "塔冠簷口", inset: -1.6, base: SK_SHAFT_TOP, height: 2.5 },
    { id: "crown/body-1", name: "塔冠", inset: 2.2, base: 190.5, height: 11.5 },
    { id: "crown/cornice-2", name: "塔冠簷口", inset: 0.6, base: 202, height: 2.5 },
    { id: "crown/body-2", name: "塔冠", inset: 5.0, base: 204.5, height: 10.5 },
    { id: "crown/cornice-3", name: "塔冠簷口", inset: 3.4, base: 215, height: 2.5 },
  ];
  for (const level of crown) {
    add({
      id: level.id,
      name: `${name} ${level.name}`,
      polygon: insetRing(tower, level.inset),
      base: level.base,
      height: level.height,
    });
  }
  // 頂層觀景層與攢尖屋頂以矩形收頭，避免內縮過深使平面退化成細長條
  const lanternL = axis.length * 0.42;
  const lanternW = axis.width * 0.52;
  add({
    id: "crown/lantern",
    name: `${name} 頂層`,
    polygon: rect(frame, 0, 0, lanternL, lanternW),
    base: 217.5,
    height: 12.5,
  });
  add({
    id: "crown/lantern-cornice",
    name: `${name} 頂層簷口`,
    polygon: rect(frame, 0, 0, lanternL + 2.4, lanternW + 2.4),
    base: 230,
    height: 2.0,
  });
  add({
    id: "crown/pyramid",
    name: `${name} 攢尖頂`,
    polygon: rect(frame, 0, 0, lanternL, lanternW),
    polygonTop: rect(frame, 0, 0, lanternL * 0.25, lanternW * 0.25),
    base: 232,
    height: SK_ROOF - 232,
  });
  add({
    id: "crown/spire",
    name: `${name} 尖頂`,
    polygon: rect(frame, 0, 0, 1.4, 1.4),
    base: SK_ROOF,
    height: SK_SPIRE - SK_ROOF,
  });
  return parts;
}

export function claim(): Local[] {
  return outline(SHIN_KONG);
}
