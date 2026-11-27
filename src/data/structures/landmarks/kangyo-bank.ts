/** 國立臺灣博物館古生物館：原勸業銀行臺北支店，沿街兩面以緊密排列的巨柱圍出柱廊，兩端為寬厚壁柱。 */
import { clipPolygonToRing } from "../../../geo/clip.ts";
import type { Local } from "../../../geo/project.ts";
import type { Feature } from "../../schema.ts";
import {
  faceFrame,
  insetRing,
  outline,
  part,
  rect,
  towards,
  type Frame,
  type PartInput,
} from "./frame.ts";

export const KANGYO_BANK = "way/253142536";

/** 各段高程（公尺），地面為 0。 */
const STYLOBATE_TOP = 0.6; // 台基
const COLUMN_BASE_TOP = 1.2; // 柱礎頂
const CAPITAL_BASE = 13.6; // 柱頭底
const CAPITAL_TOP = 15.0; // 柱頭頂
const ENTABLATURE_TOP = 17.4; // 楣樑頂
const CORNICE_TOP = 17.9; // 簷口頂
const ATTIC_TOP = 19.0; // 女兒牆飾帶頂
/** 柱廊進深、端部壁柱寬與巨柱斷面（公尺）。 */
const LOGGIA = 3.4;
const END_PIER = 3.6;
const COLUMN = 1.4;
/** 襄陽路與懷寧街兩面的巨柱數。 */
const SOUTH_COLUMNS = 8;
const WEST_COLUMNS = 5;

const KANGYO_NOTE =
  "勸業銀行舊廈為日本勸業銀行臺北支店，勸業銀行建築課設計、大林組施工，1933 年落成，" +
  "1991 年指定為古蹟，2010 年起為國立臺灣博物館古生物館（中文維基百科「勸業銀行舊廈」條目、國立臺灣博物館）：" +
  "沿街兩面分設 8 根與 5 根緊密排列的巨柱，柱頭取埃及與馬雅風格的幾何紋樣，兩端為寬厚壁柱，" +
  "柱廊兼作騎樓，女兒牆飾以獅面浮雕。" +
  "平面取自 OSM 的 way/253142536，正面朝南臨襄陽路、側面朝西臨懷寧街，" +
  "柱廊進深 3.4 公尺依騎樓面積 84 坪與沿街長度換算。" +
  "條目載大廳高 10 公尺，巨柱高依此加計樓板與屋架推得，其餘依照片比例換算，女兒牆頂約 19 公尺，為推估值。";

export function buildKangyoBank(): Feature[] {
  const ring = outline(KANGYO_BANK);
  // 正面朝南臨襄陽路（along 朝西），側面朝西臨懷寧街（along 朝北）
  const south = faceFrame(ring, towards(ring, 270), 20);
  const west = faceFrame(ring, towards(ring, 180), 20);
  const name = "國立臺灣博物館古生物館";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("kangyo-bank", KANGYO_NOTE, input));
  };

  add({
    id: "base/stylobate",
    name: `${name} 台基`,
    polygon: insetRing(ring, -0.6),
    base: 0,
    height: STYLOBATE_TOP,
  });

  // 量體只能聯集，柱廊須自館體裁去：各取沿街面向內退 LOGGIA 以後的半平面
  const halfPlane = (f: Frame): Local[] => rect(f, 0, -LOGGIA - 100, 400, 200);
  const core = clipPolygonToRing(ring, halfPlane(south.frame)).flatMap((p) =>
    clipPolygonToRing(p, halfPlane(west.frame)),
  );
  if (core.length === 0) throw new Error("勸業銀行舊廈的柱廊內牆裁切失敗");
  core.forEach((polygon, i) => {
    add({
      id: `body/core/${i}`,
      name: `${name} 柱廊後方館體`,
      polygon,
      base: STYLOBATE_TOP,
      height: ENTABLATURE_TOP - STYLOBATE_TOP,
    });
  });

  const faces: { face: { frame: Frame; length: number }; columns: number; id: string }[] = [
    { face: south, columns: SOUTH_COLUMNS, id: "south" },
    { face: west, columns: WEST_COLUMNS, id: "west" },
  ];
  for (const { face, columns, id } of faces) {
    const { frame: f, length: len } = face;
    const span = len - 2 * END_PIER;
    for (const side of [-1, 1]) {
      const key = side < 0 ? "a" : "b";
      const along = side * (len / 2 - END_PIER / 2);
      add({
        id: `${id}/end-pier/${key}`,
        name: `${name} 端部壁柱`,
        polygon: rect(f, along, -LOGGIA / 2, END_PIER, LOGGIA),
        base: STYLOBATE_TOP,
        height: ENTABLATURE_TOP - STYLOBATE_TOP,
      });
      add({
        id: `${id}/mask/${key}`,
        name: `${name} 獅面浮雕`,
        polygon: rect(f, along, 0.15, 2.0, 0.3),
        base: CORNICE_TOP,
        height: 1.0,
      });
    }
    // 巨柱：柱礎、柱身與外張的幾何紋柱頭
    for (let i = 0; i < columns; i++) {
      const along = -span / 2 + ((i + 0.5) * span) / columns;
      const lat = -0.9;
      add({
        id: `${id}/plinth/${i}`,
        name: `${name} 柱礎`,
        polygon: rect(f, along, lat, 1.8, 1.8),
        base: STYLOBATE_TOP,
        height: COLUMN_BASE_TOP - STYLOBATE_TOP,
      });
      add({
        id: `${id}/shaft/${i}`,
        name: `${name} 巨柱`,
        polygon: rect(f, along, lat, COLUMN, COLUMN),
        base: COLUMN_BASE_TOP,
        height: CAPITAL_BASE - COLUMN_BASE_TOP,
      });
      add({
        id: `${id}/capital/${i}`,
        name: `${name} 埃及馬雅風柱頭`,
        polygon: rect(f, along, lat, COLUMN, COLUMN),
        polygonTop: rect(f, along, lat, 2.0, 2.0),
        base: CAPITAL_BASE,
        height: CAPITAL_TOP - CAPITAL_BASE,
      });
    }
  }

  add({
    id: "entablature",
    name: `${name} 楣樑`,
    polygon: insetRing(ring, -0.3),
    base: CAPITAL_TOP,
    height: ENTABLATURE_TOP - CAPITAL_TOP,
  });
  add({
    id: "cornice",
    name: `${name} 簷口`,
    polygon: insetRing(ring, -0.6),
    base: ENTABLATURE_TOP,
    height: CORNICE_TOP - ENTABLATURE_TOP,
  });
  add({
    id: "attic",
    name: `${name} 女兒牆飾帶`,
    polygon: ring,
    base: CORNICE_TOP,
    height: ATTIC_TOP - CORNICE_TOP,
  });
  return parts;
}

export function claim(): Local[] {
  return outline(KANGYO_BANK);
}
