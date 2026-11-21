/** 中華民國總統府：辰野式紅磚廳舍，倒日字形平面、正面車寄與六十公尺中央塔。 */
import type { Local } from "../../../geo/project.ts";
import type { Feature } from "../../schema.ts";
import {
  faceFrame,
  insetRing,
  minAreaRect,
  outline,
  part,
  point,
  rect,
  towards,
  type Frame,
  type PartInput,
} from "./frame.ts";

export const PRESIDENTIAL_OFFICE = "relation/206817";

/** 台基頂與一至四層的樓板高程（公尺）。 */
const PLINTH_TOP = 1.6;
const FLOOR_TOPS = [7.2, 12.6, 18.0, 23.4];
/** 白色水平飾帶的厚度（公尺）：各道跨在樓板高程上下。 */
const BELT_THICKNESS = 0.7;
/** 簷口頂與女兒牆頂（公尺）。 */
const CORNICE_TOP = 25.2;
const PARAPET_TOP = 26.6;
/** 屋面高度（公尺）：中央翼的屋脊高於四周各翼。 */
const ROOF_RISE = 3.6;
const CENTRE_ROOF_RISE = 4.6;
/**
 * 各翼進深與中央翼面寬（公尺）。依此圍出的南北兩座中庭合計約 3,000 平方公尺，
 * 自輪廓面積扣除後的建築佔地接近條目所載的 6,942 平方公尺。
 */
const WING_DEPTH = 17.0;
const CENTRE_WING = 26.0;
/** 四隅衛塔的邊長、自端牆內退的距離，以及塔身頂與塔頂（公尺）。 */
const PAVILION_SIDE = 9.2;
const PAVILION_INSET = 13.0;
const PAVILION_TOP = 30.0;
const PAVILION_CAP_TOP = 34.6;
/** 正面中央突出開間的面寬與進深（公尺）。 */
const CENTRE_BAY_WIDTH = 25.6;
const CENTRE_BAY_DEPTH = 4.0;
/** 車寄的面寬、進深、柱頂、簷頂與欄杆頂（公尺）。 */
const PORCH_WIDTH = 18.0;
const PORCH_DEPTH = 7.6;
const PORCH_TOP = 8.0;
const PORCH_CORNICE_TOP = 9.2;
const PORCH_RAIL_TOP = 10.2;
/** 正面壁柱的柱距與柱身尺寸（公尺）。 */
const PILASTER_SPACING = 8.0;
const PILASTER_WIDTH = 1.3;
const PILASTER_DEPTH = 1.0;
/** 穹窿鼓座的邊長、自正面牆內退的距離，以及鼓座頂與穹窿頂（公尺）。 */
const DOME_SIDE = 16.0;
const DOME_SET_BACK = 24.0;
const DOME_DRUM_TOP = 27.4;
const DOME_TOP = 33.4;
/** 中央塔的平面邊長與塔心自正面牆內退的距離（公尺）。 */
const TOWER_SIDE = 17.0;
const TOWER_SET_BACK = 4.0;
/** 中央塔各段頂面高程（公尺）：塔頂 60 公尺為文獻值。 */
const TOWER_SHAFT_TOP = 38.0;
const TOWER_BELT_TOP = 39.2;
const TOWER_UPPER_TOP = 48.0;
const TOWER_CORNICE_TOP = 49.6;
const TOWER_CROWN_TOP = 56.0;
const TOWER_CAP_TOP = 58.6;
const TOWER_TOP = 60.0;

const OFFICE_NOTE =
  "中華民國總統府由長野宇平治競圖中選、森山松之助修改定案，1912 年動工、1919 年落成（中文維基百科「總統府 (臺灣)」條目）：" +
  "辰野金吾風格的紅磚配白色水平飾帶，主體五層，倒「日」字形平面圍出南北兩座中庭，正面朝東正對凱達格蘭大道，" +
  "中央為車寄與貫通全高的中央塔，四隅另設衛塔。平面取自 OSM 的建物關聯輪廓（relation/206817），" +
  "中央塔頂 60 公尺取自同一條目的文獻值；樓層分段、車寄、衛塔與中庭尺寸依正立面照片以輪廓長寬為比例尺換算，為推估值。";

export function buildPresidentialOffice(): Feature[] {
  const ring = outline(PRESIDENTIAL_OFFICE);
  const axis = minAreaRect(ring);
  // 正面朝東。faceFrame 取到的是正面兩翼之一，將原點沿該面移到建物中軸，
  // 車寄、穹窿與中央塔才會落在正中；lateral 正向朝外（東）。
  const { frame: wall } = faceFrame(ring, towards(ring, 0), 20);
  const radians = (wall.bearing * Math.PI) / 180;
  const toAxis =
    (axis.center[0] - wall.origin[0]) * Math.cos(radians) +
    (axis.center[1] - wall.origin[1]) * Math.sin(radians);
  const facade: Frame = { origin: point(wall, toAxis, 0), bearing: wall.bearing };
  // 正面牆面到形心的距離：四隅衛塔外凸，minAreaRect 的半寬大於牆面所在
  const depth = Math.hypot(facade.origin[0] - axis.center[0], facade.origin[1] - axis.center[1]);
  const L = axis.length;
  const name = "中華民國總統府";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("presidential-office", OFFICE_NOTE, input));
  };

  // 粗面砌築的台基略外放於牆面，一至四層牆身依樓板分段，每層之間跨一道白色飾帶
  add({
    id: "base",
    name: `${name} 台基`,
    polygon: insetRing(ring, -0.9),
    base: 0,
    height: PLINTH_TOP,
  });
  let storeyBase = PLINTH_TOP;
  FLOOR_TOPS.forEach((top, i) => {
    add({
      id: `body/${i + 1}`,
      name: `${name} ${["一", "二", "三", "四"][i]}層`,
      polygon: ring,
      base: storeyBase,
      height: top - storeyBase,
    });
    if (i < FLOOR_TOPS.length - 1) {
      add({
        id: `belt/${i + 1}`,
        name: `${name} 腰線`,
        polygon: insetRing(ring, -0.4),
        base: top - BELT_THICKNESS / 2,
        height: BELT_THICKNESS,
      });
    }
    storeyBase = top;
  });
  add({
    id: "cornice",
    name: `${name} 簷口`,
    polygon: insetRing(ring, -1.2),
    base: storeyBase,
    height: CORNICE_TOP - storeyBase,
  });
  add({
    id: "parapet",
    name: `${name} 女兒牆`,
    polygon: insetRing(ring, -0.2),
    base: CORNICE_TOP,
    height: PARAPET_TOP - CORNICE_TOP,
  });

  // 屋面依倒日字形分為五道翼，南北兩座中庭在屋頂留為天井
  const span = 2 * depth;
  const wings: {
    id: string;
    name: string;
    along: number;
    lateral: number;
    length: number;
    width: number;
    rise: number;
  }[] = [
    {
      id: "front",
      name: "正面翼",
      along: 0,
      lateral: -WING_DEPTH / 2,
      length: L,
      width: WING_DEPTH,
      rise: ROOF_RISE,
    },
    {
      id: "rear",
      name: "背面翼",
      along: 0,
      lateral: -(span - WING_DEPTH / 2),
      length: L,
      width: WING_DEPTH,
      rise: ROOF_RISE,
    },
    {
      id: "end/a",
      name: "端翼",
      along: -(L / 2 - WING_DEPTH / 2),
      lateral: -depth,
      length: WING_DEPTH,
      width: span,
      rise: ROOF_RISE,
    },
    {
      id: "end/b",
      name: "端翼",
      along: L / 2 - WING_DEPTH / 2,
      lateral: -depth,
      length: WING_DEPTH,
      width: span,
      rise: ROOF_RISE,
    },
    {
      id: "centre",
      name: "中央翼",
      along: 0,
      lateral: -depth,
      length: CENTRE_WING,
      width: span,
      rise: CENTRE_ROOF_RISE,
    },
  ];
  for (const wing of wings) {
    add({
      id: `roof/${wing.id}`,
      name: `${name} ${wing.name}屋面`,
      polygon: rect(facade, wing.along, wing.lateral, wing.length, wing.width),
      polygonTop: rect(facade, wing.along, wing.lateral, wing.length - 5.0, wing.width - 5.0),
      base: CORNICE_TOP,
      height: wing.rise,
    });
  }

  // 四隅衛塔：塔身自四層頂續起，塔頂為四坡收分的方錐
  for (const side of [-1, 1]) {
    for (const row of [0, 1]) {
      const along = side * (L / 2 - PAVILION_INSET);
      const lateral = row === 0 ? PAVILION_SIDE / 2 : -(span + PAVILION_SIDE / 2);
      const key = `${side < 0 ? "a" : "b"}${row === 0 ? "f" : "r"}`;
      add({
        id: `pavilion/${key}/shaft`,
        name: `${name} 衛塔`,
        polygon: rect(facade, along, lateral, PAVILION_SIDE, PAVILION_SIDE),
        base: PLINTH_TOP,
        height: PAVILION_TOP - PLINTH_TOP,
      });
      add({
        id: `pavilion/${key}/cap`,
        name: `${name} 衛塔頂`,
        polygon: rect(facade, along, lateral, PAVILION_SIDE + 1.0, PAVILION_SIDE + 1.0),
        polygonTop: rect(facade, along, lateral, 1.6, 1.6),
        base: PAVILION_TOP,
        height: PAVILION_CAP_TOP - PAVILION_TOP,
      });
    }
  }

  // 正面中央：突出的中央開間、其下的車寄與四根門柱，車寄頂為露臺
  add({
    id: "porch/bay",
    name: `${name} 中央開間`,
    polygon: rect(facade, 0, CENTRE_BAY_DEPTH / 2, CENTRE_BAY_WIDTH, CENTRE_BAY_DEPTH),
    base: 0,
    height: FLOOR_TOPS[FLOOR_TOPS.length - 1],
  });
  add({
    id: "porch/canopy",
    name: `${name} 車寄`,
    polygon: rect(facade, 0, PORCH_DEPTH / 2, PORCH_WIDTH, PORCH_DEPTH),
    base: PORCH_TOP,
    height: PORCH_CORNICE_TOP - PORCH_TOP,
  });
  add({
    id: "porch/cornice",
    name: `${name} 車寄簷口`,
    polygon: rect(facade, 0, PORCH_DEPTH / 2, PORCH_WIDTH + 1.2, PORCH_DEPTH + 1.2),
    base: PORCH_CORNICE_TOP - 0.5,
    height: 0.5,
  });
  add({
    id: "porch/rail",
    name: `${name} 車寄露臺欄杆`,
    polygon: rect(facade, 0, PORCH_DEPTH / 2, PORCH_WIDTH + 0.6, PORCH_DEPTH + 0.6),
    base: PORCH_CORNICE_TOP,
    height: PORCH_RAIL_TOP - PORCH_CORNICE_TOP,
  });
  for (const side of [-1, 1]) {
    for (const row of [0, 1]) {
      add({
        id: `porch/column/${side < 0 ? "a" : "b"}${row}`,
        name: `${name} 車寄柱`,
        polygon: rect(
          facade,
          side * (PORCH_WIDTH / 2 - 1.3),
          PORCH_DEPTH - 1.3 - row * 3.4,
          1.6,
          1.6,
        ),
        base: 0,
        height: PORCH_TOP,
      });
    }
  }

  // 正面壁柱：貫通二至四層，排在兩座衛塔之間，中央開間所在的柱位讓給車寄
  const bays = Math.floor(L / PILASTER_SPACING);
  const reach = L / 2 - PAVILION_INSET - PAVILION_SIDE / 2;
  for (let i = 0; i <= bays; i++) {
    const along = -(bays * PILASTER_SPACING) / 2 + i * PILASTER_SPACING;
    if (Math.abs(along) > reach) continue;
    if (Math.abs(along) < CENTRE_BAY_WIDTH / 2 + PILASTER_SPACING / 2) continue;
    add({
      id: `pilaster/${i}`,
      name: `${name} 壁柱`,
      polygon: rect(facade, along, PILASTER_DEPTH / 2, PILASTER_WIDTH, PILASTER_DEPTH),
      base: FLOOR_TOPS[0],
      height: FLOOR_TOPS[FLOOR_TOPS.length - 1] - FLOOR_TOPS[0],
    });
  }

  // 中軸線上的穹窿：位於中央塔之後，自外觀僅見鼓座與曲面頂
  add({
    id: "dome/drum",
    name: `${name} 穹窿鼓座`,
    polygon: rect(facade, 0, -DOME_SET_BACK, DOME_SIDE, DOME_SIDE),
    base: FLOOR_TOPS[FLOOR_TOPS.length - 1],
    height: DOME_DRUM_TOP - FLOOR_TOPS[FLOOR_TOPS.length - 1],
  });
  add({
    id: "dome/shell",
    name: `${name} 穹窿`,
    polygon: rect(facade, 0, -DOME_SET_BACK, DOME_SIDE - 1.2, DOME_SIDE - 1.2),
    polygonTop: rect(facade, 0, -DOME_SET_BACK, 3.0, 3.0),
    base: DOME_DRUM_TOP,
    height: DOME_TOP - DOME_DRUM_TOP,
  });

  // 中央塔：自簷口續起，逐段收分至 60 公尺的塔頂
  const stages: { id: string; name: string; top: number; lower: number; upper: number }[] = [
    { id: "shaft", name: "中央塔", top: TOWER_SHAFT_TOP, lower: TOWER_SIDE, upper: TOWER_SIDE - 1.0 },
    { id: "belt", name: "中央塔腰線", top: TOWER_BELT_TOP, lower: TOWER_SIDE + 0.8, upper: TOWER_SIDE + 0.8 },
    { id: "upper", name: "中央塔上段", top: TOWER_UPPER_TOP, lower: TOWER_SIDE - 2.2, upper: TOWER_SIDE - 3.4 },
    {
      id: "cornice",
      name: "中央塔簷口",
      top: TOWER_CORNICE_TOP,
      lower: TOWER_SIDE - 1.0,
      upper: TOWER_SIDE - 1.0,
    },
    { id: "crown", name: "中央塔塔冠", top: TOWER_CROWN_TOP, lower: TOWER_SIDE - 3.8, upper: TOWER_SIDE - 8.4 },
    { id: "cap", name: "中央塔塔頂", top: TOWER_CAP_TOP, lower: TOWER_SIDE - 8.0, upper: 3.4 },
    { id: "finial", name: "中央塔旗桿座", top: TOWER_TOP, lower: 2.6, upper: 1.6 },
  ];
  let towerBase = CORNICE_TOP;
  for (const stage of stages) {
    add({
      id: `tower/${stage.id}`,
      name: `${name} ${stage.name}`,
      polygon: rect(facade, 0, -TOWER_SET_BACK, stage.lower, stage.lower),
      polygonTop: rect(facade, 0, -TOWER_SET_BACK, stage.upper, stage.upper),
      base: towerBase,
      height: stage.top - towerBase,
    });
    towerBase = stage.top;
  }
  return parts;
}

export function claim(): Local[] {
  return outline(PRESIDENTIAL_OFFICE);
}
