/** 國立臺灣博物館：三層館舍、正面多立克柱廊與三角山頭，中央為鼓座承半球圓頂。 */
import type { Local } from "../../../geo/project.ts";
import type { Feature } from "../../schema.ts";
import {
  faceFrame,
  insetRing,
  minAreaRect,
  outline,
  part,
  rect,
  towards,
  type Frame,
  type PartInput,
} from "./frame.ts";

export const TAIWAN_MUSEUM = "way/1050624691";

/** 各層樓面與屋頂的高程（公尺）：以大廳柱高與圓頂天井的文獻值為準，其餘依正立面照片換算。 */
const MUSEUM_PODIUM_TOP = 1.5;
const MUSEUM_GROUND_TOP = 7.2;
const MUSEUM_BELT_BASE = 7.0;
const MUSEUM_BELT_HEIGHT = 0.55;
const MUSEUM_WALL_TOP = 13.6;
const MUSEUM_CORNICE_TOP = 14.6;
const MUSEUM_PARAPET_TOP = 15.9;
const MUSEUM_ROOF_TOP = 16.3;
/** 鼓座起拱面：條目載鑲嵌玻璃天井離大廳地板 54 尺（約 16.4 公尺），加台基高即為此值。 */
const MUSEUM_DRUM_BASE = 17.9;
const MUSEUM_DRUM_TOP = 22.1;
const MUSEUM_DRUM_CORNICE_TOP = 22.9;
/** 柱廊巨柱總高：條目載大廳柱高 32 尺，柱廊巨柱取同一尺度（公尺）。 */
const MUSEUM_COLUMN = 9.7;
const MUSEUM_COLUMN_PLINTH = 0.45;
const MUSEUM_COLUMN_CAPITAL = 0.7;
const MUSEUM_COLUMN_SHAFT = 1.15;
/** 柱身收分後的頂部直徑（公尺）。 */
const MUSEUM_COLUMN_NECK = 0.96;
/** 正面柱廊的開間數。 */
const MUSEUM_BAYS = 6;
/** 三角山頭的高度與圓頂的分段數。 */
const MUSEUM_PEDIMENT = 3.8;
const MUSEUM_DOME_STEPS = 4;
/** 球面自起拱面算起取至此比例的半徑高，其上換為燈籠。 */
const MUSEUM_DOME_RISE = 0.92;
const MUSEUM_LANTERN = 1.4;
const MUSEUM_LANTERN_CAP = 0.5;

/**
 * 平面分段比例，量自 OSM 輪廓：中央量體約佔全長四分之一、兩端亭約七分之一，
 * 正面柱廊的面寬即中央量體的前緣，圓頂外徑約為中央量體面寬的六成。
 */
const MUSEUM_CENTRE_SPAN = 0.255;
const MUSEUM_PORCH_SPAN = 0.213;
const MUSEUM_PAVILION_SPAN = 0.148;
const MUSEUM_PAVILION_DEPTH = 0.67;
const MUSEUM_DOME_SPAN = 0.56;

const MUSEUM_NOTE =
  "國立臺灣博物館本館原為兒玉總督暨後藤民政長官紀念館，1915 年落成，" +
  "由臺灣總督府技師野村一郎與技手荒木榮一設計（中文維基百科「國立臺灣博物館」條目）：" +
  "新古典主義形式，正面六根多立克巨柱構成柱廊，柱廊之上為三角形山頭，" +
  "中央大廳以鼓座承半球圓頂，圓頂下方為鑲嵌玻璃天井，兩翼為展覽室。" +
  "平面取自 OSM 輪廓 way/1050624691（長 90.9 公尺、寬 31.8 公尺），中央量體、柱廊與兩端亭的分段量自該輪廓。" +
  "高度以條目所載大廳柱高 32 尺（約 9.7 公尺）定柱廊巨柱，以天井離地板 54 尺（約 16.4 公尺）定鼓座起拱面，" +
  "其餘各層依正立面照片以柱廊開間寬（由面寬推得約 3.2 公尺）為比例尺換算，燈籠頂約 30.8 公尺，為推估值。";

export function buildTaiwanMuseum(): Feature[] {
  const ring = outline(TAIWAN_MUSEUM);
  const axis = minAreaRect(ring);
  // 正面朝北，面向二二八和平公園與襄陽路。取朝北外牆只為定出外側方位，
  // 柱廊本身位於長軸中點，即中央量體的正中，故座標系原點取輪廓的最小矩形中心
  const { frame: north } = faceFrame(ring, towards(ring, 90), 20);
  const facade: Frame = { origin: axis.center, bearing: north.bearing };
  const L = axis.length;
  const W = axis.width;
  const front = W / 2;
  const porch = L * MUSEUM_PORCH_SPAN;
  const centre = L * MUSEUM_CENTRE_SPAN;
  const name = "國立臺灣博物館";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("taiwan-museum", MUSEUM_NOTE, input));
  };

  // 台基與正面前階：前階自柱廊前緣往北放坡，上緣收回台基邊線
  add({
    id: "base/podium",
    name: `${name} 台基`,
    polygon: insetRing(ring, -1.4),
    base: 0,
    height: MUSEUM_PODIUM_TOP,
  });
  add({
    id: "base/stair",
    name: `${name} 正面前階`,
    polygon: rect(facade, 0, front + 4.2, porch * 0.8, 8.4),
    polygonTop: rect(facade, 0, front + 1.2, porch * 0.8, 2.4),
    base: 0,
    height: MUSEUM_PODIUM_TOP,
  });

  // 牆身：一層、腰線、二三層、簷口與女兒牆
  add({
    id: "wall/ground",
    name: `${name} 一層`,
    polygon: ring,
    base: MUSEUM_PODIUM_TOP,
    height: MUSEUM_GROUND_TOP - MUSEUM_PODIUM_TOP,
  });
  add({
    id: "wall/belt",
    name: `${name} 腰線`,
    polygon: insetRing(ring, -0.45),
    base: MUSEUM_BELT_BASE,
    height: MUSEUM_BELT_HEIGHT,
  });
  add({
    id: "wall/upper",
    name: `${name} 二三層`,
    polygon: ring,
    base: MUSEUM_GROUND_TOP,
    height: MUSEUM_WALL_TOP - MUSEUM_GROUND_TOP,
  });
  add({
    id: "wall/cornice",
    name: `${name} 簷口`,
    polygon: insetRing(ring, -0.9),
    base: MUSEUM_WALL_TOP,
    height: MUSEUM_CORNICE_TOP - MUSEUM_WALL_TOP,
  });
  add({
    id: "wall/parapet",
    name: `${name} 女兒牆`,
    polygon: insetRing(ring, 0.5),
    base: MUSEUM_CORNICE_TOP,
    height: MUSEUM_PARAPET_TOP - MUSEUM_CORNICE_TOP,
  });
  // 女兒牆內的低緩屋面：1996 年整修後為鋼構屋頂，自簷口往內收
  add({
    id: "roof/deck",
    name: `${name} 屋面`,
    polygon: insetRing(ring, 1.6),
    polygonTop: insetRing(ring, 4.0),
    base: MUSEUM_CORNICE_TOP,
    height: MUSEUM_ROOF_TOP - MUSEUM_CORNICE_TOP,
  });

  // 中央量體與兩端亭：屋面之上的增高段，中央段同時承接鼓座
  add({
    id: "roof/attic",
    name: `${name} 中央閣樓`,
    polygon: rect(facade, 0, 0, centre - 2.0, W - 5.0),
    base: MUSEUM_CORNICE_TOP,
    height: MUSEUM_DRUM_BASE - MUSEUM_CORNICE_TOP,
  });
  const pavilionSpan = L * MUSEUM_PAVILION_SPAN;
  const pavilionDepth = W * MUSEUM_PAVILION_DEPTH;
  for (const side of [-1, 1]) {
    add({
      id: `roof/pavilion/${side < 0 ? "west" : "east"}`,
      name: `${name} 端亭女兒牆`,
      polygon: rect(
        facade,
        (side * (L - pavilionSpan)) / 2,
        0,
        pavilionSpan - 1.6,
        pavilionDepth - 1.6,
      ),
      base: MUSEUM_CORNICE_TOP,
      height: MUSEUM_PARAPET_TOP + 1.2 - MUSEUM_CORNICE_TOP,
    });
  }

  // 正面柱廊：六根多立克巨柱，柱礎、收分的柱身與柱頭各自成件
  const bay = porch / MUSEUM_BAYS;
  const columnLateral = front - 0.45;
  const shaftBase = MUSEUM_PODIUM_TOP + MUSEUM_COLUMN_PLINTH;
  const capitalBase = MUSEUM_PODIUM_TOP + MUSEUM_COLUMN - MUSEUM_COLUMN_CAPITAL;
  for (let i = 0; i < MUSEUM_BAYS; i++) {
    const along = -porch / 2 + (i + 0.5) * bay;
    add({
      id: `colonnade/plinth/${i}`,
      name: `${name} 柱礎`,
      polygon: rect(facade, along, columnLateral, 1.45, 1.45),
      base: MUSEUM_PODIUM_TOP,
      height: MUSEUM_COLUMN_PLINTH,
    });
    add({
      id: `colonnade/shaft/${i}`,
      name: `${name} 多立克柱身`,
      polygon: rect(facade, along, columnLateral, MUSEUM_COLUMN_SHAFT, MUSEUM_COLUMN_SHAFT),
      polygonTop: rect(facade, along, columnLateral, MUSEUM_COLUMN_NECK, MUSEUM_COLUMN_NECK),
      base: shaftBase,
      height: capitalBase - shaftBase,
    });
    add({
      id: `colonnade/capital/${i}`,
      name: `${name} 柱頭`,
      polygon: rect(facade, along, columnLateral, 1.35, 1.35),
      base: capitalBase,
      height: MUSEUM_COLUMN_CAPITAL,
    });
  }
  const columnTop = MUSEUM_PODIUM_TOP + MUSEUM_COLUMN;
  add({
    id: "colonnade/entablature",
    name: `${name} 柱廊楣樑`,
    polygon: rect(facade, 0, front - 1.1, porch + 1.6, 2.2),
    base: columnTop,
    height: MUSEUM_WALL_TOP - columnTop,
  });
  add({
    id: "colonnade/cornice",
    name: `${name} 柱廊簷口`,
    polygon: rect(facade, 0, front - 0.6, porch + 3.0, 3.2),
    base: MUSEUM_WALL_TOP,
    height: MUSEUM_CORNICE_TOP - MUSEUM_WALL_TOP,
  });
  // 三角山頭：上緣收為屋脊，脊線留 1.4 公尺以承山頭頂飾
  add({
    id: "colonnade/pediment",
    name: `${name} 三角山頭`,
    polygon: rect(facade, 0, front - 1.0, porch + 1.0, 2.4),
    polygonTop: rect(facade, 0, front - 1.0, 1.4, 2.4),
    base: MUSEUM_CORNICE_TOP,
    height: MUSEUM_PEDIMENT,
  });

  // 圓頂：方形鼓座、鼓座簷口、球面的四段收分、燈籠與頂蓋
  const domeDiameter = centre * MUSEUM_DOME_SPAN;
  const radius = domeDiameter / 2;
  add({
    id: "dome/drum",
    name: `${name} 圓頂鼓座`,
    polygon: rect(facade, 0, 0, domeDiameter + 2.4, domeDiameter + 2.4),
    base: MUSEUM_DRUM_BASE,
    height: MUSEUM_DRUM_TOP - MUSEUM_DRUM_BASE,
  });
  add({
    id: "dome/drum-cornice",
    name: `${name} 鼓座簷口`,
    polygon: rect(facade, 0, 0, domeDiameter + 3.4, domeDiameter + 3.4),
    base: MUSEUM_DRUM_TOP,
    height: MUSEUM_DRUM_CORNICE_TOP - MUSEUM_DRUM_TOP,
  });
  const rise = radius * MUSEUM_DOME_RISE;
  for (let k = 0; k < MUSEUM_DOME_STEPS; k++) {
    const lower = (k / MUSEUM_DOME_STEPS) * rise;
    const upper = ((k + 1) / MUSEUM_DOME_STEPS) * rise;
    const halfLower = Math.sqrt(radius * radius - lower * lower);
    const halfUpper = Math.sqrt(radius * radius - upper * upper);
    add({
      id: `dome/shell/${k}`,
      name: `${name} 圓頂球面`,
      polygon: rect(facade, 0, 0, halfLower * 2, halfLower * 2),
      polygonTop: rect(facade, 0, 0, halfUpper * 2, halfUpper * 2),
      base: MUSEUM_DRUM_CORNICE_TOP + lower,
      height: upper - lower,
    });
  }
  const lanternBase = MUSEUM_DRUM_CORNICE_TOP + rise;
  add({
    id: "dome/lantern",
    name: `${name} 圓頂燈籠`,
    polygon: rect(facade, 0, 0, 3.0, 3.0),
    base: lanternBase,
    height: MUSEUM_LANTERN,
  });
  add({
    id: "dome/lantern-cap",
    name: `${name} 燈籠頂蓋`,
    polygon: rect(facade, 0, 0, 3.8, 3.8),
    polygonTop: rect(facade, 0, 0, 0.6, 0.6),
    base: lanternBase + MUSEUM_LANTERN,
    height: MUSEUM_LANTERN_CAP,
  });
  return parts;
}

export function claim(): Local[] {
  return outline(TAIWAN_MUSEUM);
}
