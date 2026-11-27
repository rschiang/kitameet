/** 臺灣銀行文物館：原帝國生命保險臺北支店，花崗石牆裙、壁柱分間的三層牆身、退縮的第四層與轉角塔樓。 */
import type { Local } from "../../../geo/project.ts";
import type { Feature } from "../../schema.ts";
import { faceFrame, insetRing, outline, part, rect, towards, type PartInput } from "./frame.ts";

export const IMPERIAL_LIFE = "way/269788967";

/** 各段高程（公尺），地面為 0。 */
const DADO_TOP = 1.8; // 花崗石牆裙頂
const GROUND_TOP = 5.0; // 一層頂
const THIRD_TOP = 13.0; // 三層頂
const FRIEZE_TOP = 14.4; // 浮雕飾帶頂
const CORNICE_TOP = 15.0; // 簷口頂
const ATTIC_TOP = 18.2; // 四層退縮樓頂
const COPING_TOP = 18.6; // 壓頂
const CORNER_TOP = 20.4; // 轉角塔樓頂
const MERLON_TOP = 21.1; // 轉角頂飾
/** 轉角塔樓邊長（公尺）、正面壁柱開間數、正門寬（公尺）與塔樓每面頂飾數。 */
const CORNER = 9.0;
const WEST_BAYS = 10;
const PORTAL = 4.4;
const MERLONS = 5;

const IMPERIAL_LIFE_NOTE =
  "帝國生命保險株式會社臺北支店初建於 1910 年，因蟻害於 1936 年由竹中工務店改建，1937 年 6 月落成，" +
  "捨去舊廈的中央尖塔、改採折衷主義設計並貼淺色面磚，1998 年指定為直轄市定古蹟，" +
  "2013 年起為臺灣銀行文物館（中文維基百科「帝國生命保險臺北支店」條目）。" +
  "平面取自 OSM 的 way/269788967（博愛路與寶慶路口東北角），正面朝西臨博愛路。" +
  "照片可見花崗石牆裙、二三層壁柱、浮雕飾帶、退縮的第四層與略高的轉角塔樓。" +
  "查無高度文獻，層數依照片計得、層高依同期辦公建築推估，轉角頂飾約 21.1 公尺，為推估值；" +
  "正門位於正面中央亦為推估。";

export function buildImperialLife(): Feature[] {
  const ring = outline(IMPERIAL_LIFE);
  // 正面朝西臨博愛路（along 朝北）；南面取寶慶路側西段（along 朝西）
  const { frame: west, length: L } = faceFrame(ring, towards(ring, 180), 20);
  const { frame: south, length: Ls } = faceFrame(ring, towards(ring, 270), 20);
  const name = "臺灣銀行文物館";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("imperial-life", IMPERIAL_LIFE_NOTE, input));
  };

  add({
    id: "base/dado",
    name: `${name} 花崗石牆裙`,
    polygon: insetRing(ring, -0.3),
    base: 0,
    height: DADO_TOP,
  });
  add({
    id: "body/main",
    name: `${name} 一至三層`,
    polygon: ring,
    base: DADO_TOP,
    height: THIRD_TOP - DADO_TOP,
  });
  add({
    id: "belt/ground",
    name: `${name} 一二層間腰帶`,
    polygon: insetRing(ring, -0.2),
    base: GROUND_TOP - 0.2,
    height: 0.4,
  });
  add({
    id: "frieze",
    name: `${name} 浮雕飾帶`,
    polygon: insetRing(ring, -0.25),
    base: THIRD_TOP,
    height: FRIEZE_TOP - THIRD_TOP,
  });
  add({
    id: "cornice",
    name: `${name} 簷口`,
    polygon: insetRing(ring, -0.8),
    base: FRIEZE_TOP,
    height: CORNICE_TOP - FRIEZE_TOP,
  });
  add({
    id: "attic",
    name: `${name} 四層退縮樓`,
    polygon: insetRing(ring, 0.5),
    base: CORNICE_TOP,
    height: ATTIC_TOP - CORNICE_TOP,
  });
  add({
    id: "coping",
    name: `${name} 壓頂`,
    polygon: insetRing(ring, 0.3),
    base: ATTIC_TOP,
    height: COPING_TOP - ATTIC_TOP,
  });

  // 轉角塔樓：博愛路與寶慶路口，第四層略高一截，頂緣沿兩面街排列頂飾
  add({
    id: "corner/pavilion",
    name: `${name} 轉角塔樓`,
    polygon: rect(west, -L / 2 + CORNER / 2, -CORNER / 2, CORNER, CORNER),
    base: CORNICE_TOP,
    height: CORNER_TOP - CORNICE_TOP,
  });
  for (let k = 0; k < MERLONS; k++) {
    const offset = (CORNER * (k + 0.5)) / MERLONS;
    add({
      id: `corner/merlon/west/${k}`,
      name: `${name} 轉角頂飾`,
      polygon: rect(west, -L / 2 + offset, -0.3, 0.6, 0.6),
      base: CORNER_TOP,
      height: MERLON_TOP - CORNER_TOP,
    });
    add({
      id: `corner/merlon/south/${k}`,
      name: `${name} 轉角頂飾`,
      polygon: rect(south, Ls / 2 - offset, -0.3, 0.6, 0.6),
      base: CORNER_TOP,
      height: MERLON_TOP - CORNER_TOP,
    });
  }

  // 正面的二三層壁柱，正門所在的開間不設柱
  for (let i = 1; i < WEST_BAYS; i++) {
    const along = -L / 2 + (i * L) / WEST_BAYS;
    if (Math.abs(along) < PORTAL / 2) continue;
    add({
      id: `pilaster/${i}`,
      name: `${name} 二三層壁柱`,
      polygon: rect(west, along, 0.15, 0.7, 0.3),
      base: GROUND_TOP,
      height: THIRD_TOP - GROUND_TOP,
    });
  }

  add({
    id: "portal",
    name: `${name} 正門石框`,
    polygon: rect(west, 0, 0.25, PORTAL, 0.5),
    base: 0,
    height: GROUND_TOP + 0.6,
  });
  add({
    id: "portal/steps",
    name: `${name} 正門台階`,
    polygon: rect(west, 0, 1.0, PORTAL, 2.0),
    polygonTop: rect(west, 0, 0.3, PORTAL, 0.6),
    base: 0,
    height: 0.6,
  });
  return parts;
}

export function claim(): Local[] {
  return outline(IMPERIAL_LIFE);
}
