/** 臺灣銀行總行大廈：花崗石基座上的三層銀行，正面二三層以八根巨柱構成柱廊，兩端為轉角實牆。 */
import { clipPolygonToRing } from "../../../geo/clip.ts";
import type { Local } from "../../../geo/project.ts";
import type { Feature } from "../../schema.ts";
import { faceFrame, insetRing, outline, part, rect, towards, type PartInput } from "./frame.ts";

export const BANK_OF_TAIWAN = "way/269788993";

/** 各段高程（公尺），地面為 0。 */
const PLINTH_TOP = 1.2; // 花崗石基座
const GROUND_TOP = 6.6; // 一層營業廳頂
const BELT_TOP = 7.2; // 一二層間腰帶
const COLUMN_BASE_TOP = 7.8; // 柱礎頂
const CAPITAL_BASE = 15.2; // 柱頭底
const CAPITAL_TOP = 16.2; // 柱頭頂
const ENTABLATURE_TOP = 17.8; // 楣樑頂
const CORNICE_TOP = 18.6; // 簷口頂
const PARAPET_TOP = 19.8; // 女兒牆頂
/** 柱廊進深、轉角實牆佔正面長度的比例與巨柱（公尺）。 */
const LOGGIA = 3.0;
const CORNER_RATIO = 0.2;
const COLUMNS = 8;
const COLUMN = 1.25;
/** 寶慶路側立面的壁柱開間數。 */
const SOUTH_BAYS = 12;

const BANK_OF_TAIWAN_NOTE =
  "臺灣銀行總行大廈由西村好時設計、大倉土木施工，1934 年動工、1937 年竣工，地上三層、地下一層，" +
  "外牆與列柱以花崗石砌築，1998 年列為市定古蹟（中文維基百科「臺灣銀行總行大廈」條目）。" +
  "正面臨重慶南路，二三層以八根科林斯式變體柱頭的巨柱構成柱廊，兩端為渾厚的轉角實牆；" +
  "寶慶路側立面以壁柱分間。平面取自 OSM 的 way/269788993。" +
  "查無總高文獻，一層營業廳挑高與兩層巨柱依照片比例、以正面長 57.6 公尺為比例尺換算，" +
  "女兒牆頂約 19.8 公尺，為推估值。";

export function buildBankOfTaiwan(): Feature[] {
  const ring = outline(BANK_OF_TAIWAN);
  // 正面朝東臨重慶南路（along 朝南），側面朝南臨寶慶路
  const { frame: east, length: facade } = faceFrame(ring, towards(ring, 0), 20);
  const { frame: south, length: southLength } = faceFrame(ring, towards(ring, 270), 20);
  const name = "臺灣銀行總行大廈";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("bank-of-taiwan", BANK_OF_TAIWAN_NOTE, input));
  };

  add({
    id: "base/plinth",
    name: `${name} 花崗石基座`,
    polygon: insetRing(ring, -0.5),
    base: 0,
    height: PLINTH_TOP,
  });
  add({
    id: "base/stair",
    name: `${name} 正面前階`,
    polygon: rect(east, 0, 1.2, 8.0, 2.4),
    polygonTop: rect(east, 0, 0.4, 8.0, 0.8),
    base: 0,
    height: PLINTH_TOP,
  });
  add({
    id: "body/ground",
    name: `${name} 一層營業廳`,
    polygon: ring,
    base: PLINTH_TOP,
    height: GROUND_TOP - PLINTH_TOP,
  });
  add({
    id: "belt",
    name: `${name} 腰帶`,
    polygon: insetRing(ring, -0.4),
    base: GROUND_TOP,
    height: BELT_TOP - GROUND_TOP,
  });

  // 二三層：東面退縮 LOGGIA 讓出柱廊，以半平面自輪廓裁出
  const upper = clipPolygonToRing(ring, rect(east, 0, -LOGGIA - 100, 400, 200));
  if (upper.length === 0) throw new Error("臺灣銀行總行的柱廊內牆裁切失敗");
  upper.forEach((polygon, i) => {
    add({
      id: `body/upper/${i}`,
      name: `${name} 二三層`,
      polygon,
      base: BELT_TOP,
      height: CAPITAL_TOP - BELT_TOP,
    });
  });

  // 柱廊兩端的轉角實牆
  const corner = facade * CORNER_RATIO;
  for (const side of [-1, 1]) {
    add({
      id: `loggia/corner/${side < 0 ? "n" : "s"}`,
      name: `${name} 轉角實牆`,
      polygon: rect(east, side * (facade / 2 - corner / 2), -LOGGIA / 2, corner, LOGGIA),
      base: BELT_TOP,
      height: CAPITAL_TOP - BELT_TOP,
    });
  }

  // 八根巨柱：柱礎、柱身與外張的柱頭
  const span = facade - 2 * corner;
  for (let i = 0; i < COLUMNS; i++) {
    const along = -span / 2 + ((i + 0.5) * span) / COLUMNS;
    add({
      id: `column/plinth/${i}`,
      name: `${name} 柱礎`,
      polygon: rect(east, along, -0.8, 1.6, 1.6),
      base: BELT_TOP,
      height: COLUMN_BASE_TOP - BELT_TOP,
    });
    add({
      id: `column/shaft/${i}`,
      name: `${name} 巨柱`,
      polygon: rect(east, along, -0.8, COLUMN, COLUMN),
      base: COLUMN_BASE_TOP,
      height: CAPITAL_BASE - COLUMN_BASE_TOP,
    });
    add({
      id: `column/capital/${i}`,
      name: `${name} 科林斯式變體柱頭`,
      polygon: rect(east, along, -0.8, COLUMN, COLUMN),
      polygonTop: rect(east, along, -0.8, 1.9, 1.9),
      base: CAPITAL_BASE,
      height: CAPITAL_TOP - CAPITAL_BASE,
    });
  }
  add({
    id: "loggia/balustrade",
    name: `${name} 花瓶欄杆`,
    polygon: rect(east, 0, -0.8, span, 0.4),
    base: BELT_TOP,
    height: 1.0,
  });

  // 寶慶路側的壁柱
  for (let i = 1; i < SOUTH_BAYS; i++) {
    add({
      id: `pilaster/${i}`,
      name: `${name} 南面壁柱`,
      polygon: rect(south, -southLength / 2 + (i * southLength) / SOUTH_BAYS, 0.2, 1.0, 0.4),
      base: BELT_TOP,
      height: CAPITAL_TOP - BELT_TOP,
    });
  }

  add({
    id: "entablature",
    name: `${name} 楣樑`,
    polygon: insetRing(ring, -0.2),
    base: CAPITAL_TOP,
    height: ENTABLATURE_TOP - CAPITAL_TOP,
  });
  add({
    id: "cornice",
    name: `${name} 簷口`,
    polygon: insetRing(ring, -1.0),
    base: ENTABLATURE_TOP,
    height: CORNICE_TOP - ENTABLATURE_TOP,
  });
  add({
    id: "parapet",
    name: `${name} 女兒牆`,
    polygon: insetRing(ring, 0.3),
    base: CORNICE_TOP,
    height: PARAPET_TOP - CORNICE_TOP,
  });
  return parts;
}

export function claim(): Local[] {
  return outline(BANK_OF_TAIWAN);
}
