/** 第四代臺北車站站體：四周出柱列的方正量體，上覆大跨距的四坡屋頂。 */
import type { Local } from "../../../geo/project.ts";
import type { Feature } from "../../schema.ts";
import { minAreaRect, outline, part, rect, type Frame, type PartInput } from "./frame.ts";

export const TAIPEI_STATION = "way/23641610";

/** 文獻值：站體長 149 公尺、寬 110 公尺、高 48 公尺，地上 6 層。 */
const STATION_LENGTH = 149;
const STATION_WIDTH = 110;
const STATION_TOP = 48;
/** 台基、柱列與主量體的高程（公尺）。 */
const STATION_TERRACE = 1.4;
const STATION_BODY_BASE = 12.5;
const STATION_WALL_TOP = 34.0;
const STATION_EAVE_TOP = 36.6;
/** 外柱的斷面與柱距（公尺）。 */
const STATION_PIER = 1.9;
const STATION_PIER_SPACING = 9.3;
/** 屋簷出挑距離與屋頂兩段斜面的內收量（公尺）。 */
const STATION_EAVE_REACH = 3.0;
const STATION_ROOF_INSET = [11.5, 16.5];

const STATION_NOTE =
  "第四代臺北車站 1989 年啟用，長 149 公尺、寬 110 公尺、高 48 公尺、地上 6 層" +
  "（中文維基百科「臺北車站」條目）。外觀為四周出柱列的方正量體，上覆大跨距的四坡屋頂。" +
  "量體中心與方位取自 OSM 輪廓，柱距、樓層分段與屋頂斜度依外觀照片比例換算，為推估值。";

export function buildTaipeiStation(): Feature[] {
  const ring = outline(TAIPEI_STATION);
  const axis = minAreaRect(ring);
  const frame: Frame = { origin: axis.center, bearing: axis.bearing };
  const name = "臺北車站";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("taipei-station", STATION_NOTE, input));
  };

  // 站前平臺：OSM 輪廓比站體本身大一圈，視為四周的平臺與雨庇範圍
  add({
    id: "terrace",
    name: `${name} 平臺`,
    polygon: ring,
    base: 0,
    height: STATION_TERRACE,
  });
  // 一、二層退縮於柱列之後
  add({
    id: "arcade-wall",
    name: `${name} 一二層`,
    polygon: rect(frame, 0, 0, STATION_LENGTH - 5, STATION_WIDTH - 5),
    base: STATION_TERRACE,
    height: STATION_BODY_BASE - STATION_TERRACE,
  });
  // 三至六層主量體，牆面退於樓層帶與外柱之後
  add({
    id: "body",
    name: `${name} 三至六層`,
    polygon: rect(frame, 0, 0, STATION_LENGTH - 1.6, STATION_WIDTH - 1.6),
    base: STATION_BODY_BASE,
    height: STATION_WALL_TOP - STATION_BODY_BASE,
  });

  // 柱列：一二層為粗壯的外柱，三層以上換成較細的壁柱，四角則為厚實的角柱
  const longCount = Math.round(STATION_LENGTH / STATION_PIER_SPACING);
  const shortCount = Math.round(STATION_WIDTH / STATION_PIER_SPACING);
  const longStep = STATION_LENGTH / longCount;
  const shortStep = STATION_WIDTH / shortCount;
  const arcadeTop = STATION_BODY_BASE + 1.1;
  for (let i = 0; i < longCount; i++) {
    const along = -STATION_LENGTH / 2 + (i + 0.5) * longStep;
    for (const side of [-1, 1]) {
      add({
        id: `pier/long/${i}/${side < 0 ? "s" : "n"}`,
        name: `${name} 外柱`,
        polygon: rect(frame, along, (side * STATION_WIDTH) / 2, STATION_PIER, STATION_PIER),
        base: STATION_TERRACE,
        height: arcadeTop - STATION_TERRACE,
      });
    }
  }
  for (let i = 0; i < shortCount; i++) {
    const lateral = -STATION_WIDTH / 2 + (i + 0.5) * shortStep;
    for (const side of [-1, 1]) {
      add({
        id: `pier/short/${i}/${side < 0 ? "w" : "e"}`,
        name: `${name} 外柱`,
        polygon: rect(frame, (side * STATION_LENGTH) / 2, lateral, STATION_PIER, STATION_PIER),
        base: STATION_TERRACE,
        height: arcadeTop - STATION_TERRACE,
      });
    }
  }
  // 上層壁柱：柱距取外柱的一半，斷面較薄，與樓層帶織成格狀立面
  for (let i = 0; i < longCount * 2; i++) {
    const along = -STATION_LENGTH / 2 + (i + 0.5) * (longStep / 2);
    for (const side of [-1, 1]) {
      add({
        id: `pilaster/long/${i}/${side < 0 ? "s" : "n"}`,
        name: `${name} 壁柱`,
        polygon: rect(frame, along, (side * STATION_WIDTH) / 2, 1.1, 1.3),
        base: STATION_BODY_BASE,
        height: STATION_WALL_TOP - STATION_BODY_BASE,
      });
    }
  }
  for (let i = 0; i < shortCount * 2; i++) {
    const lateral = -STATION_WIDTH / 2 + (i + 0.5) * (shortStep / 2);
    for (const side of [-1, 1]) {
      add({
        id: `pilaster/short/${i}/${side < 0 ? "w" : "e"}`,
        name: `${name} 壁柱`,
        polygon: rect(frame, (side * STATION_LENGTH) / 2, lateral, 1.3, 1.1),
        base: STATION_BODY_BASE,
        height: STATION_WALL_TOP - STATION_BODY_BASE,
      });
    }
  }
  for (const sa of [-1, 1]) {
    for (const sl of [-1, 1]) {
      add({
        id: `pier/corner/${sa < 0 ? "w" : "e"}${sl < 0 ? "s" : "n"}`,
        name: `${name} 角柱`,
        polygon: rect(
          frame,
          (sa * STATION_LENGTH) / 2,
          (sl * STATION_WIDTH) / 2,
          STATION_PIER * 1.9,
          STATION_PIER * 1.9,
        ),
        base: STATION_TERRACE,
        height: STATION_WALL_TOP - STATION_TERRACE,
      });
    }
  }

  // 樓層帶：略突出於壁柱的水平線腳，帶與帶之間即深凹的窗帶
  const bands = [STATION_BODY_BASE, 18.0, 23.5, 29.0, 32.6];
  bands.forEach((level, i) => {
    add({
      id: `band/${i}`,
      name: `${name} 樓層帶`,
      polygon: rect(frame, 0, 0, STATION_LENGTH + 0.7, STATION_WIDTH + 0.7),
      base: level,
      height: 1.4,
    });
  });

  // 出入口雨棚：每面三處
  for (const side of [-1, 1]) {
    for (const along of [-STATION_LENGTH / 3, 0, STATION_LENGTH / 3]) {
      add({
        id: `canopy/long/${side < 0 ? "s" : "n"}/${along.toFixed(0)}`,
        name: `${name} 出入口雨棚`,
        polygon: rect(frame, along, (side * (STATION_WIDTH + 3.4)) / 2, 8, 3.4),
        base: 4.6,
        height: 0.7,
      });
    }
    for (const lateral of [-STATION_WIDTH / 3, 0, STATION_WIDTH / 3]) {
      add({
        id: `canopy/short/${side < 0 ? "w" : "e"}/${lateral.toFixed(0)}`,
        name: `${name} 出入口雨棚`,
        polygon: rect(frame, (side * (STATION_LENGTH + 3.4)) / 2, lateral, 3.4, 8),
        base: 4.6,
        height: 0.7,
      });
    }
  }

  // 簷口與四坡屋頂
  const eaveL = STATION_LENGTH + 2 * STATION_EAVE_REACH;
  const eaveW = STATION_WIDTH + 2 * STATION_EAVE_REACH;
  add({
    id: "eave",
    name: `${name} 簷口`,
    polygon: rect(frame, 0, 0, eaveL, eaveW),
    base: STATION_WALL_TOP,
    height: STATION_EAVE_TOP - STATION_WALL_TOP,
  });
  let roofBase = STATION_EAVE_TOP;
  let lower = { length: eaveL, width: eaveW };
  const rises = [5.0, 4.0];
  STATION_ROOF_INSET.forEach((inset, i) => {
    const upper = { length: lower.length - 2 * inset, width: lower.width - 2 * inset };
    add({
      id: `roof/${i}`,
      name: `${name} 屋頂`,
      polygon: rect(frame, 0, 0, lower.length, lower.width),
      polygonTop: rect(frame, 0, 0, upper.length, upper.width),
      base: roofBase,
      height: rises[i],
    });
    roofBase += rises[i];
    lower = upper;
  });
  add({
    id: "roof/deck",
    name: `${name} 屋頂平臺`,
    polygon: rect(frame, 0, 0, lower.length, lower.width),
    base: roofBase,
    height: 0.8,
  });
  add({
    id: "roof/penthouse",
    name: `${name} 屋頂機房`,
    polygon: rect(frame, 0, 0, lower.length * 0.42, lower.width * 0.34),
    base: roofBase + 0.8,
    height: STATION_TOP - roofBase - 0.8,
  });
  return parts;
}

export function claim(): Local[] {
  return outline(TAIPEI_STATION);
}
