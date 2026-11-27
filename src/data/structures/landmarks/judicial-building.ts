/** 司法大廈：日字形的四層廳舍、淺綠面磚牆身與中央塔的興亞式屋頂。 */
import { decompose } from "../../../geo/measure.ts";
import type { Local } from "../../../geo/project.ts";
import type { Feature } from "../../schema.ts";
import {
  faceFrame,
  insetRing,
  outline,
  part,
  point,
  rect,
  shift,
  towards,
  type Frame,
  type PartInput,
} from "./frame.ts";

export const JUDICIAL_BUILDING = "relation/2609653";

/** 台基、各層樓板與女兒牆的高程（公尺），地面為 0。 */
const PLINTH_TOP = 1.3;
const FIRST_TOP = 6.1;
const SECOND_TOP = 10.7;
const THIRD_TOP = 15.3;
const CORNICE_TOP = 16.4;
const FOURTH_TOP = 20.4;
const PARAPET_TOP = 21.3;
/** 中央塔各段的高程；寶瓶頂面即條目所載的 31.8 公尺。 */
const TOWER_TOP = 25.4;
const TOWER_CORNICE_TOP = 26.2;
const TOWER_EAVE_TOP = 26.9;
const ROOF_TOP_1 = 28.3;
const ROOF_TOP_2 = 29.5;
const ROOF_TOP_3 = 30.4;
const FINIAL_TOP = 31.8;

/**
 * 翼深取正面長度的比例。日字形的四面外翼與中央翼以此厚度放樣，
 * 餘下的兩座天井各約 1,600 平方公尺，各層樓地板面積因而約 1,870 坪，
 * 與條目所載「各層樓面積都達到 1,800 餘坪」相符。
 */
const WING_RATIO = 0.16;
/** 四層增建自牆面內縮、女兒牆再內縮的距離（公尺）。 */
const FOURTH_INSET = 1.0;
const PARAPET_INSET = 0.85;
/** 正面垂直壁柱的開間數與柱身尺寸（公尺）。 */
const PILASTER_BAYS = 18;
const PILASTER_WIDTH = 1.1;
const PILASTER_DEPTH = 0.7;
/** 門廊的開間數、柱身尺寸與拱圈參數（公尺）。 */
const PORCH_BAYS = 3;
const PORCH_PIER = 1.3;
const PORCH_PAIR_GAP = 0.6;
const PORCH_DEPTH = 2.6;
const PORCH_SPRING = 3.9;
/** 三圓心弧拱較半圓拱扁平，拱高只取淨跨半徑的六成。 */
const PORCH_RISE_RATIO = 0.6;
const PORCH_ARCH_STEPS = 2;
const PORCH_LINTEL_TOP = 6.7;
const PORCH_BALUSTRADE_TOP = 7.7;
/** 塔頂屋簷外伸與寶瓶的尺寸（公尺）。 */
const TOWER_EAVE_REACH = 1.1;
const FINIAL_WIDTH = 1.8;

const JUDICIAL_NOTE =
  "司法大廈為井手薰設計、1929 年起造、1934 年落成的折衷主義官署（中文維基百科「司法大廈」條目）：" +
  "鋼筋混凝土造，外牆貼淺綠色毛面面磚，立面以垂直壁柱分間，一樓門廊為三圓心弧拱配雙柱，" +
  "中央塔覆八角形的興亞式屋頂。平面取自 OSM 的 relation/2609653 輪廓，" +
  "日字形的四面外翼與中央翼依翼深取正面長度的 0.16 放樣，各層樓地板面積因而約 1,870 坪，" +
  "與條目所載「各層樓面積都達到 1,800 餘坪」相符。" +
  "正面朝東面向重慶南路；輪廓東側中央凸出約 14 公尺的量體即門廊與中央塔所在，各翼進深取西牆至東側主牆的距離。" +
  "全高依條目所載中央塔興亞式屋頂的 31.8 公尺定案，寶瓶頂面即為該值；" +
  "1934 年落成時的三層簷口、1977 年增建的四層與塔身各段高程，則依正立面照片量得各段與正面長度的比值後換算，為推估值。" +
  "八角形的塔頂以四坡屋頂加四角翹起的簷角近似，兩座採光天井則以各翼之間的空隙呈現。";

export function buildJudicialBuilding(): Feature[] {
  const ring = outline(JUDICIAL_BUILDING);
  // 正面朝東，面向重慶南路。西牆為輪廓最長的直邊，以它量出各翼進深與東側中央的凸出量
  const { frame: west, length: facade } = faceFrame(ring, towards(ring, 180), 20); // 西牆 100.5 m，along 朝北、lateral 朝西
  const { frame: eastWall } = faceFrame(ring, towards(ring, 0), 20); // 東側主牆（43.7 m 段）
  const bodyDepth = -decompose(west.origin, west.bearing, eastWall.origin).lateral; // ≈ 78.6
  const projection =
    Math.max(...ring.map((p) => -decompose(west.origin, west.bearing, p).lateral)) - bodyDepth; // ≈ 14.4
  // 正面：東側主牆，along 朝南、lateral 朝東
  const frame: Frame = { origin: point(west, 0, -bodyDepth), bearing: west.bearing + 180 };
  const porchFace = projection - PORCH_DEPTH; // 中央凸出量體（塔基）的正面，門廊立於其前
  const wing = facade * WING_RATIO;
  const name = "司法大廈";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("judicial-building", JUDICIAL_NOTE, input));
  };

  // 台基：外凸於牆面一圈
  add({
    id: "base/plinth",
    name: `${name} 台基`,
    polygon: insetRing(ring, -0.9),
    base: 0,
    height: PLINTH_TOP,
  });

  // 日字形的五道翼：四面外翼圍成口字，中央翼貫通東西，兩側各留一座天井
  const wings: { id: string; name: string; frameArgs: [number, number, number, number] }[] = [
    { id: "east", name: "正面翼", frameArgs: [0, -wing / 2, facade, wing] },
    { id: "west", name: "背面翼", frameArgs: [0, -(bodyDepth - wing / 2), facade, wing] },
    { id: "south", name: "南翼", frameArgs: [(facade - wing) / 2, -bodyDepth / 2, wing, bodyDepth] },
    { id: "north", name: "北翼", frameArgs: [-(facade - wing) / 2, -bodyDepth / 2, wing, bodyDepth] },
    { id: "centre", name: "中央翼", frameArgs: [0, -bodyDepth / 2, wing, bodyDepth] },
  ];
  for (const w of wings) {
    const [along, lateral, length, width] = w.frameArgs;
    add({
      id: `body/lower/${w.id}`,
      name: `${name} ${w.name}一至三層`,
      polygon: rect(frame, along, lateral, length, width),
      base: PLINTH_TOP,
      height: THIRD_TOP - PLINTH_TOP,
    });
    add({
      id: `body/fourth/${w.id}`,
      name: `${name} ${w.name}增建四層`,
      polygon: rect(
        frame,
        along,
        lateral,
        length - 2 * FOURTH_INSET,
        width - 2 * FOURTH_INSET,
      ),
      base: CORNICE_TOP,
      height: FOURTH_TOP - CORNICE_TOP,
    });
  }

  // 東側中央凸出的量體：門廊與中央塔的塔基
  const towerSide = wing;
  add({
    id: "body/lower/projection",
    name: `${name} 中央塔基`,
    polygon: rect(frame, 0, porchFace / 2, towerSide, porchFace),
    base: PLINTH_TOP,
    height: THIRD_TOP - PLINTH_TOP,
  });

  // 水平腰線：一二層之間、二樓窗台（桂冠花環與竹節飾帶）、二三層之間
  add({
    id: "belt/first",
    name: `${name} 一二層腰線`,
    polygon: insetRing(ring, -0.4),
    base: FIRST_TOP - 0.3,
    height: 0.6,
  });
  add({
    id: "belt/sill",
    name: `${name} 二樓窗台飾帶`,
    polygon: insetRing(ring, -0.25),
    base: FIRST_TOP + 1.5,
    height: 0.4,
  });
  add({
    id: "belt/second",
    name: `${name} 二三層腰線`,
    polygon: insetRing(ring, -0.3),
    base: SECOND_TOP - 0.25,
    height: 0.5,
  });

  // 1934 年落成時的三層簷口，與增建四層之上的女兒牆
  add({
    id: "cornice",
    name: `${name} 簷口`,
    polygon: insetRing(ring, -0.8),
    base: THIRD_TOP,
    height: CORNICE_TOP - THIRD_TOP,
  });
  add({
    id: "parapet",
    name: `${name} 女兒牆`,
    polygon: insetRing(ring, PARAPET_INSET),
    base: FOURTH_TOP,
    height: PARAPET_TOP - FOURTH_TOP,
  });

  // 正面的垂直壁柱：貫通二三層，中央塔所佔的開間不設柱
  const pilasterBay = facade / PILASTER_BAYS;
  for (let i = 0; i <= PILASTER_BAYS; i++) {
    const along = -facade / 2 + i * pilasterBay;
    if (Math.abs(along) < towerSide / 2) continue;
    add({
      id: `pilaster/${i}`,
      name: `${name} 壁柱`,
      polygon: rect(frame, along, PILASTER_DEPTH / 2 - 0.1, PILASTER_WIDTH, PILASTER_DEPTH),
      base: FIRST_TOP,
      height: THIRD_TOP - FIRST_TOP,
    });
  }

  // 正面中央的門廊：台階、三開間的雙柱與三圓心弧拱
  const porchBay = towerSide / PORCH_BAYS;
  const porchWidth = towerSide;
  const porchLateral = porchFace + PORCH_DEPTH / 2;
  add({
    id: "porch/deck",
    name: `${name} 門廊台階`,
    polygon: rect(frame, 0, porchLateral + 0.4, porchWidth + 2.6, PORCH_DEPTH + 1.4),
    base: 0,
    height: PLINTH_TOP,
  });
  for (let i = 0; i <= PORCH_BAYS; i++) {
    const centre = -porchWidth / 2 + i * porchBay;
    // 雙柱：每處柱位由兩根細柱並立
    for (const side of [-1, 1]) {
      add({
        id: `porch/pier/${i}/${side < 0 ? "l" : "r"}`,
        name: `${name} 門廊雙柱`,
        polygon: rect(
          frame,
          centre + (side * PORCH_PAIR_GAP) / 2,
          porchLateral,
          (PORCH_PIER - PORCH_PAIR_GAP) / 2,
          PORCH_DEPTH,
        ),
        base: PLINTH_TOP,
        height: PORCH_SPRING - PLINTH_TOP,
      });
    }
  }
  const clear = porchBay - PORCH_PIER;
  const archRadius = clear / 2;
  const archRise = archRadius * PORCH_RISE_RATIO;
  const archStep = archRise / PORCH_ARCH_STEPS;
  for (let bay = 0; bay < PORCH_BAYS; bay++) {
    const centre = -porchWidth / 2 + (bay + 0.5) * porchBay;
    for (let k = 0; k < PORCH_ARCH_STEPS; k++) {
      const rise = (k + 1) * archStep;
      // 以半橢圓逼近三圓心弧拱：該層頂面處的淨開半寬
      const halfOpen = archRadius * Math.sqrt(Math.max(1 - (rise / archRise) ** 2, 0));
      const width = archRadius - halfOpen;
      if (width < 0.05) continue;
      for (const side of [-1, 1]) {
        add({
          id: `porch/arch/${bay}/${k}/${side < 0 ? "l" : "r"}`,
          name: `${name} 門廊拱圈`,
          polygon: rect(
            frame,
            centre + side * (halfOpen + width / 2),
            porchLateral,
            width,
            PORCH_DEPTH,
          ),
          base: PORCH_SPRING + k * archStep,
          height: archStep,
        });
      }
    }
  }
  add({
    id: "porch/lintel",
    name: `${name} 門廊楣樑`,
    polygon: rect(frame, 0, porchLateral, porchWidth + PORCH_PIER, PORCH_DEPTH),
    base: PORCH_SPRING + archRise,
    height: PORCH_LINTEL_TOP - PORCH_SPRING - archRise,
  });
  add({
    id: "porch/balustrade",
    name: `${name} 門廊陽台欄杆`,
    polygon: rect(frame, 0, porchLateral, porchWidth + PORCH_PIER, PORCH_DEPTH),
    base: PORCH_LINTEL_TOP,
    height: PORCH_BALUSTRADE_TOP - PORCH_LINTEL_TOP,
  });

  // 中央塔：塔身坐落於東側中央的塔基與中央翼之上，平面取中央翼的翼寬
  const towerLateral = porchFace - towerSide / 2;
  add({
    id: "tower/gable",
    name: `${name} 塔基山牆`,
    polygon: rect(frame, 0, porchFace + 0.3, towerSide * 0.86, 0.6),
    polygonTop: rect(frame, 0, porchFace + 0.3, towerSide * 0.42, 0.6),
    base: CORNICE_TOP + 0.4,
    height: PARAPET_TOP - CORNICE_TOP - 0.4,
  });
  add({
    id: "tower/shaft",
    name: `${name} 中央塔塔身`,
    polygon: rect(frame, 0, towerLateral, towerSide, towerSide),
    base: THIRD_TOP,
    height: TOWER_TOP - THIRD_TOP,
  });
  add({
    id: "tower/cornice",
    name: `${name} 中央塔簷口`,
    polygon: rect(frame, 0, towerLateral, towerSide + 1.0, towerSide + 1.0),
    base: TOWER_TOP,
    height: TOWER_CORNICE_TOP - TOWER_TOP,
  });

  // 興亞式屋頂：出挑的屋簷、三段收分的四坡屋面、四角翹起的簷角與塔頂寶瓶
  const eaveSide = towerSide + 2 * TOWER_EAVE_REACH;
  add({
    id: "roof/eave",
    name: `${name} 興亞式屋簷`,
    polygon: rect(frame, 0, towerLateral, eaveSide, eaveSide),
    base: TOWER_CORNICE_TOP,
    height: TOWER_EAVE_TOP - TOWER_CORNICE_TOP,
  });
  // 屋面愈近塔頂收得愈急，以三段收分近似八角攢尖的輪廓
  const slopes: { top: number; side: number }[] = [
    { top: ROOF_TOP_1, side: eaveSide - 4.3 },
    { top: ROOF_TOP_2, side: eaveSide - 9.9 },
    { top: ROOF_TOP_3, side: eaveSide - 15.1 },
  ];
  let slopeBase = TOWER_EAVE_TOP;
  let lowerSide = eaveSide;
  slopes.forEach((slope, i) => {
    const upper = Math.max(slope.side, FINIAL_WIDTH);
    add({
      id: `roof/slope/${i}`,
      name: `${name} 興亞式屋面`,
      polygon: rect(frame, 0, towerLateral, lowerSide, lowerSide),
      polygonTop: rect(frame, 0, towerLateral, upper, upper),
      base: slopeBase,
      height: slope.top - slopeBase,
    });
    slopeBase = slope.top;
    lowerSide = upper;
  });
  // 簷角：四角沿對角向外上方翹起，近似屋頂四周的波浪曲線
  for (const sa of [-1, 1]) {
    for (const sl of [-1, 1]) {
      const along = sa * (eaveSide / 2 - 1.0);
      const lateral = towerLateral + sl * (eaveSide / 2 - 1.0);
      add({
        id: `roof/corner/${sa < 0 ? "n" : "s"}${sl < 0 ? "w" : "e"}`,
        name: `${name} 簷角`,
        polygon: rect(frame, along, lateral, 2.0, 2.0),
        polygonTop: shift(rect(frame, along, lateral, 1.1, 1.1), frame, sa * 1.2, sl * 1.2),
        base: TOWER_EAVE_TOP - 0.3,
        height: 1.2,
      });
    }
  }
  add({
    id: "roof/finial",
    name: `${name} 塔頂寶瓶`,
    polygon: rect(frame, 0, towerLateral, FINIAL_WIDTH, FINIAL_WIDTH),
    polygonTop: rect(frame, 0, towerLateral, FINIAL_WIDTH * 0.4, FINIAL_WIDTH * 0.4),
    base: ROOF_TOP_3,
    height: FINIAL_TOP - ROOF_TOP_3,
  });
  return parts;
}

export function claim(): Local[] {
  return outline(JUDICIAL_BUILDING);
}
