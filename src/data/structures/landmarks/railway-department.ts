/** 鐵道部廳舍：一層磚造、二層半木構造，弧形轉角塔、車寄與陡斜的銅瓦屋頂。 */
import type { Local } from "../../../geo/project.ts";
import type { Feature } from "../../schema.ts";
import {
  faceFrame,
  insetRing,
  outline,
  part,
  point,
  rect,
  towards,
  type Frame,
  type PartInput,
} from "./frame.ts";

export const RAILWAY_DEPARTMENT = "way/319875831";

/** 台基、兩層牆身與簷口的高程（公尺），依正立面照片以外牆長為比例尺換算。 */
const RAIL_PLINTH_TOP = 0.95;
const RAIL_FIRST_TOP = 5.35;
const RAIL_BELT_TOP = 5.85;
const RAIL_SECOND_TOP = 10.15;
const RAIL_EAVE_TOP = 10.95;
/** 屋頂兩段斜面的頂面與正脊高程（公尺）。 */
const RAIL_SLOPE_MID = 15.6;
const RAIL_SLOPE_TOP = 17.75;
const RAIL_RIDGE_TOP = 18.3;
/** 屋面自牆線外伸（負值）與兩段斜面的內收距離（公尺）。 */
const RAIL_EAVE_REACH = 0.9;
const RAIL_SLOPE_MID_INSET = 4.4;
const RAIL_SLOPE_TOP_INSET = 8.6;
/** 轉角塔塔身、塔簷與塔頂各段的高程（公尺）。 */
const RAIL_TOWER_TOP = 13.6;
const RAIL_TOWER_CORNICE_TOP = 14.4;
const RAIL_TOWER_ROOF_MID = 17.6;
const RAIL_TOWER_ROOF_TOP = 20.4;
const RAIL_TOWER_FINIAL_TOP = 21.6;
/** 轉角塔身較轉角弦長加寬的量、進深與內移量（公尺）。 */
const RAIL_TOWER_WIDEN = 3.4;
const RAIL_TOWER_DEPTH = 8.6;
const RAIL_TOWER_INSET = 3.2;
/** 車寄柱高、楣樑與頂蓋的高程，以及自轉角外伸的距離（公尺）。 */
const RAIL_PORCH_TOP = 5.05;
const RAIL_PORCH_BEAM_TOP = 5.75;
const RAIL_PORCH_ROOF_TOP = 7.35;
const RAIL_PORCH_REACH = 8.2;
const RAIL_PORCH_PIER = 1.0;
/** 衛塔塔身與塔頂高程、平面尺寸，以及自轉角沿街退開的距離（公尺）。 */
const RAIL_TURRET_TOP = 12.95;
const RAIL_TURRET_ROOF_TOP = 16.35;
const RAIL_TURRET_WIDTH = 5.0;
const RAIL_TURRET_DEPTH = 6.0;
const RAIL_TURRET_OFFSET = 8.5;
/** 老虎窗的高程、平面尺寸與自牆線退入屋面的距離（公尺）。 */
const RAIL_DORMER_BASE = 11.6;
const RAIL_DORMER_TOP = 14.2;
const RAIL_DORMER_ROOF_TOP = 15.2;
const RAIL_DORMER_WIDTH = 2.0;
const RAIL_DORMER_DEPTH = 2.6;
const RAIL_DORMER_LATERAL = -2.0;
/** 老虎窗沿屋面排列的範圍佔外牆長的比例。 */
const RAIL_DORMER_SPREAD = 0.66;
/** 煙囪頂高程與平面尺寸（公尺）。 */
const RAIL_CHIMNEY_TOP = 19.5;
const RAIL_CHIMNEY_WIDTH = 1.4;
const RAIL_CHIMNEY_DEPTH = 1.2;

const RAIL_NOTE =
  "臺灣總督府交通局鐵道部廳舍由森山松之助設計、1919 與 1920 年分兩期完工" +
  "（中文維基百科「臺灣總督府交通局鐵道部 (文化資產)」條目）：一層為磚造、二層為半木構造，" +
  "屋頂與牆體露出木樑柱，平面略呈 L 形，主入口設於轉角、兩側立衛塔，陡斜屋面開老虎窗並立煙囪。" +
  "平面取自 OSM 的主廳舍輪廓，沿街兩面與轉角的方位、長度與翼深皆由該輪廓推算。" +
  "條目未載總高，各部高度依維基共享資源的正立面照片，以輪廓量得的延平北路側外牆長（約 51 公尺）為比例尺換算：" +
  "簷口約為該長度的 0.21 倍（約 11 公尺）、屋脊約 0.36 倍（約 18 公尺）、轉角塔頂約 0.42 倍（約 22 公尺），" +
  "開間數、老虎窗與煙囪位置均為推估。";

/** 以立面座標系量得某點的 along 與 lateral，供翼深與轉角定位，不另立座標常數。 */
function measure(frame: Frame, target: Local): { along: number; lateral: number } {
  const origin = point(frame, 0, 0);
  const alongUnit = point(frame, 1, 0);
  const lateralUnit = point(frame, 0, 1);
  const ax = alongUnit[0] - origin[0];
  const ay = alongUnit[1] - origin[1];
  const lx = lateralUnit[0] - origin[0];
  const ly = lateralUnit[1] - origin[1];
  const dx = target[0] - origin[0];
  const dy = target[1] - origin[1];
  return { along: dx * ax + dy * ay, lateral: dx * lx + dy * ly };
}

export function buildRailwayDepartment(): Feature[] {
  const ring = outline(RAILWAY_DEPARTMENT);
  // L 形平面的外接矩形為斜向，不足以定位立面：兩翼各取沿街的外牆，轉角再由兩面的端點合成
  const east = faceFrame(ring, towards(ring, 0), 20);
  const south = faceFrame(ring, towards(ring, -90), 20);
  // 兩翼的中庭側外牆與沿街外牆平行，其間距即該翼的進深
  const eastDepth = -measure(east.frame, faceFrame(ring, towards(ring, 180), 20).frame.origin)
    .lateral;
  const southDepth = -measure(south.frame, faceFrame(ring, towards(ring, 90), 20).frame.origin)
    .lateral;
  // 轉角弧面介於兩面外牆的端點之間，其弦長即轉角的寬度
  const endEast = point(east.frame, east.length / 2, 0);
  const endSouth = point(south.frame, -south.length / 2, 0);
  const corner: Frame = {
    origin: [(endEast[0] + endSouth[0]) / 2, (endEast[1] + endSouth[1]) / 2],
    bearing: (east.frame.bearing + south.frame.bearing) / 2,
  };
  const cornerSpan = Math.hypot(endEast[0] - endSouth[0], endEast[1] - endSouth[1]);

  const name = "鐵道部廳舍";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("railway-department", RAIL_NOTE, input));
  };

  // 台基、一層磚造牆身、腰線與二層半木構造牆身
  add({
    id: "base",
    name: `${name} 台基`,
    polygon: insetRing(ring, -0.7),
    base: 0,
    height: RAIL_PLINTH_TOP,
  });
  add({
    id: "wall/first",
    name: `${name} 一層磚造牆身`,
    polygon: ring,
    base: RAIL_PLINTH_TOP,
    height: RAIL_FIRST_TOP - RAIL_PLINTH_TOP,
  });
  add({
    id: "belt",
    name: `${name} 腰線`,
    polygon: insetRing(ring, -0.3),
    base: RAIL_FIRST_TOP,
    height: RAIL_BELT_TOP - RAIL_FIRST_TOP,
  });
  add({
    id: "wall/second",
    name: `${name} 二層半木構造牆身`,
    polygon: insetRing(ring, 0.2),
    base: RAIL_BELT_TOP,
    height: RAIL_SECOND_TOP - RAIL_BELT_TOP,
  });
  add({
    id: "eaves",
    name: `${name} 簷口`,
    polygon: insetRing(ring, -RAIL_EAVE_REACH),
    base: RAIL_SECOND_TOP,
    height: RAIL_EAVE_TOP - RAIL_SECOND_TOP,
  });

  // 屋頂：下段陡斜的主坡與上段趨緩的收頭，兩翼頂面各立正脊
  add({
    id: "roof/slope/0",
    name: `${name} 屋頂下段斜面`,
    polygon: insetRing(ring, -RAIL_EAVE_REACH),
    polygonTop: insetRing(ring, RAIL_SLOPE_MID_INSET),
    base: RAIL_EAVE_TOP,
    height: RAIL_SLOPE_MID - RAIL_EAVE_TOP,
  });
  add({
    id: "roof/slope/1",
    name: `${name} 屋頂上段斜面`,
    polygon: insetRing(ring, RAIL_SLOPE_MID_INSET),
    polygonTop: insetRing(ring, RAIL_SLOPE_TOP_INSET),
    base: RAIL_SLOPE_MID,
    height: RAIL_SLOPE_TOP - RAIL_SLOPE_MID,
  });
  const wings: { id: string; label: string; frame: Frame; length: number; depth: number }[] = [
    { id: "east", label: "東翼", frame: east.frame, length: east.length, depth: eastDepth },
    { id: "south", label: "南翼", frame: south.frame, length: south.length, depth: southDepth },
  ];
  for (const wing of wings) {
    add({
      id: `roof/ridge/${wing.id}`,
      name: `${name} ${wing.label}屋脊`,
      polygon: rect(wing.frame, 0, -wing.depth / 2, wing.length - 12, 1.2),
      base: RAIL_SLOPE_TOP,
      height: RAIL_RIDGE_TOP - RAIL_SLOPE_TOP,
    });
  }

  // 老虎窗：沿兩翼的下段斜面等距排列，窗身出挑、窗頂收為小斜坡
  for (const wing of wings) {
    const count = Math.max(3, Math.round((wing.length * RAIL_DORMER_SPREAD) / 7));
    const spread = wing.length * RAIL_DORMER_SPREAD;
    const spacing = spread / (count - 1);
    for (let i = 0; i < count; i++) {
      const along = -spread / 2 + i * spacing;
      add({
        id: `roof/dormer/${wing.id}/${i}`,
        name: `${name} 老虎窗`,
        polygon: rect(
          wing.frame,
          along,
          RAIL_DORMER_LATERAL,
          RAIL_DORMER_WIDTH,
          RAIL_DORMER_DEPTH,
        ),
        base: RAIL_DORMER_BASE,
        height: RAIL_DORMER_TOP - RAIL_DORMER_BASE,
      });
      add({
        id: `roof/dormer/${wing.id}/${i}/cap`,
        name: `${name} 老虎窗頂`,
        polygon: rect(
          wing.frame,
          along,
          RAIL_DORMER_LATERAL,
          RAIL_DORMER_WIDTH + 0.5,
          RAIL_DORMER_DEPTH + 0.5,
        ),
        polygonTop: rect(wing.frame, along, RAIL_DORMER_LATERAL - 0.4, 0.6, 0.6),
        base: RAIL_DORMER_TOP,
        height: RAIL_DORMER_ROOF_TOP - RAIL_DORMER_TOP,
      });
    }
  }

  // 煙囪：立於兩翼屋脊一側，自屋面穿出
  for (const wing of wings) {
    add({
      id: `roof/chimney/${wing.id}`,
      name: `${name} 煙囪`,
      polygon: rect(
        wing.frame,
        -wing.length * 0.3,
        -wing.depth / 2 + 1.5,
        RAIL_CHIMNEY_WIDTH,
        RAIL_CHIMNEY_DEPTH,
      ),
      base: RAIL_EAVE_TOP,
      height: RAIL_CHIMNEY_TOP - RAIL_EAVE_TOP,
    });
    add({
      id: `roof/chimney/${wing.id}/cap`,
      name: `${name} 煙囪頂`,
      polygon: rect(
        wing.frame,
        -wing.length * 0.3,
        -wing.depth / 2 + 1.5,
        RAIL_CHIMNEY_WIDTH + 0.4,
        RAIL_CHIMNEY_DEPTH + 0.4,
      ),
      base: RAIL_CHIMNEY_TOP,
      height: 0.5,
    });
  }

  // 弧形轉角塔：塔身自台基直上、塔簷出挑，塔頂分兩段收分後立尖頂
  const towerWidth = cornerSpan + RAIL_TOWER_WIDEN;
  add({
    id: "tower/shaft",
    name: `${name} 轉角塔身`,
    polygon: rect(corner, 0, -RAIL_TOWER_INSET, towerWidth, RAIL_TOWER_DEPTH),
    base: RAIL_PLINTH_TOP,
    height: RAIL_TOWER_TOP - RAIL_PLINTH_TOP,
  });
  add({
    id: "tower/belt",
    name: `${name} 轉角塔腰線`,
    polygon: rect(corner, 0, -RAIL_TOWER_INSET, towerWidth + 0.6, RAIL_TOWER_DEPTH + 0.6),
    base: RAIL_FIRST_TOP,
    height: RAIL_BELT_TOP - RAIL_FIRST_TOP,
  });
  add({
    id: "tower/cornice",
    name: `${name} 轉角塔簷`,
    polygon: rect(corner, 0, -RAIL_TOWER_INSET, towerWidth + 1.2, RAIL_TOWER_DEPTH + 1.2),
    base: RAIL_TOWER_TOP,
    height: RAIL_TOWER_CORNICE_TOP - RAIL_TOWER_TOP,
  });
  add({
    id: "tower/roof/0",
    name: `${name} 轉角塔頂下段`,
    polygon: rect(corner, 0, -RAIL_TOWER_INSET, towerWidth + 0.6, RAIL_TOWER_DEPTH + 0.6),
    polygonTop: rect(corner, 0, -RAIL_TOWER_INSET, towerWidth - 2.4, RAIL_TOWER_DEPTH - 2.4),
    base: RAIL_TOWER_CORNICE_TOP,
    height: RAIL_TOWER_ROOF_MID - RAIL_TOWER_CORNICE_TOP,
  });
  add({
    id: "tower/roof/1",
    name: `${name} 轉角塔頂上段`,
    polygon: rect(corner, 0, -RAIL_TOWER_INSET, towerWidth - 2.4, RAIL_TOWER_DEPTH - 2.4),
    polygonTop: rect(corner, 0, -RAIL_TOWER_INSET, towerWidth - 8.0, RAIL_TOWER_DEPTH - 6.2),
    base: RAIL_TOWER_ROOF_MID,
    height: RAIL_TOWER_ROOF_TOP - RAIL_TOWER_ROOF_MID,
  });
  add({
    id: "tower/finial",
    name: `${name} 轉角塔尖`,
    polygon: rect(corner, 0, -RAIL_TOWER_INSET, 1.1, 1.1),
    polygonTop: rect(corner, 0, -RAIL_TOWER_INSET, 0.3, 0.3),
    base: RAIL_TOWER_ROOF_TOP,
    height: RAIL_TOWER_FINIAL_TOP - RAIL_TOWER_ROOF_TOP,
  });

  // 車寄：四柱撐起楣樑與頂蓋，自轉角朝街口外伸
  const pierAlong = (cornerSpan + RAIL_TOWER_WIDEN) / 2 - RAIL_PORCH_PIER;
  for (const side of [-1, 1]) {
    for (const row of [0, 1]) {
      const lateral = RAIL_PORCH_REACH - 1.2 - row * (RAIL_PORCH_REACH - 3.6);
      add({
        id: `porch/pier/${side < 0 ? "l" : "r"}/${row}`,
        name: `${name} 車寄柱`,
        polygon: rect(
          corner,
          side * pierAlong,
          lateral,
          RAIL_PORCH_PIER,
          RAIL_PORCH_PIER,
        ),
        base: RAIL_PLINTH_TOP,
        height: RAIL_PORCH_TOP - RAIL_PLINTH_TOP,
      });
    }
  }
  add({
    id: "porch/beam",
    name: `${name} 車寄楣樑`,
    polygon: rect(
      corner,
      0,
      RAIL_PORCH_REACH / 2,
      towerWidth - 0.6,
      RAIL_PORCH_REACH - 0.8,
    ),
    base: RAIL_PORCH_TOP,
    height: RAIL_PORCH_BEAM_TOP - RAIL_PORCH_TOP,
  });
  add({
    id: "porch/roof",
    name: `${name} 車寄頂蓋`,
    polygon: rect(corner, 0, RAIL_PORCH_REACH / 2, towerWidth + 0.6, RAIL_PORCH_REACH),
    polygonTop: rect(corner, 0, RAIL_PORCH_REACH / 2 - 1.0, towerWidth - 5.0, 2.2),
    base: RAIL_PORCH_BEAM_TOP,
    height: RAIL_PORCH_ROOF_TOP - RAIL_PORCH_BEAM_TOP,
  });

  // 衛塔：轉角兩側沿街各立一座，塔頂收為四坡尖頂
  for (const wing of wings) {
    const sign = wing.id === "east" ? 1 : -1;
    const along = sign * (wing.length / 2 - RAIL_TURRET_OFFSET);
    add({
      id: `turret/${wing.id}`,
      name: `${name} 衛塔`,
      polygon: rect(wing.frame, along, -1.4, RAIL_TURRET_WIDTH, RAIL_TURRET_DEPTH),
      base: RAIL_PLINTH_TOP,
      height: RAIL_TURRET_TOP - RAIL_PLINTH_TOP,
    });
    add({
      id: `turret/${wing.id}/roof`,
      name: `${name} 衛塔頂`,
      polygon: rect(wing.frame, along, -1.4, RAIL_TURRET_WIDTH + 0.8, RAIL_TURRET_DEPTH + 0.8),
      polygonTop: rect(wing.frame, along, -1.4, 0.8, 0.8),
      base: RAIL_TURRET_TOP,
      height: RAIL_TURRET_ROOF_TOP - RAIL_TURRET_TOP,
    });
  }
  return parts;
}

export function claim(): Local[] {
  return outline(RAILWAY_DEPARTMENT);
}
