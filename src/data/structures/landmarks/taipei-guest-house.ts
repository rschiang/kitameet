/** 臺北賓館本館洋樓：兩層新巴洛克牆身、羅馬雙柱陽臺與馬薩式屋頂。 */
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

export const TAIPEI_GUEST_HOUSE = "way/1050800283";

/** 北面柱廊的開間數，取自北面照片所見的連續拱圈與其上的雙柱。 */
const GARDEN_BAYS = 6;
/** 各部高度相對開間模距的倍數，依正立面與北面照片量得。 */
const PLINTH_RATIO = 0.35;
const FIRST_RATIO = 1.2;
const SECOND_RATIO = 1.22;
const CORNICE_RATIO = 0.3;
const MANSARD_STEEP_RATIO = 1.05;
const MANSARD_FLAT_RATIO = 0.36;
const RIDGE_RAIL_RATIO = 0.14;
const TOWER_DRUM_RATIO = 0.85;
const TOWER_DOME_RATIO = 0.95;
const TOWER_FINIAL_RATIO = 0.3;
/** 馬薩屋頂兩段斜面的頂面內縮量（公尺）。 */
const STEEP_TOP_INSET = 2.2;
const FLAT_TOP_INSET = 4.0;
/** 車寄平面（公尺）：面積合於條目所載 1913 年增建的 11 坪。 */
const PORTE_LENGTH = 7.6;
const PORTE_DEPTH = 4.8;
/** 角塔中心自北面外牆內縮的距離與塔身邊長（公尺）。 */
const TOWER_INSET = 3.5;
const TOWER_SIZE = 6.4;

const GUEST_HOUSE_NOTE =
  "臺北賓館本館洋樓 1901 年由福田東吾、野村一郎設計落成，原為臺灣總督官邸，" +
  "1913 年由森山松之助改築為新巴洛克樣式（中文維基百科「臺北賓館」條目）：" +
  "兩層磚石造牆身、羅馬雙柱構成的二層陽臺、覆石板瓦並開老虎窗的馬薩式屋頂，屋脊帶鑄鐵欄杆，兩端各有一座角塔。" +
  "平面取自 OSM way/1050800283 的本館輪廓，車寄平面依條目所載增建 11 坪（約 36 平方公尺）定為 7.6 乘 4.8 公尺。" +
  "條目未載總高，故以北面柱廊外牆（長約 26 公尺）除以照片所見的六開間，得開間模距約 4.3 公尺為比例尺，" +
  "再依正立面與北面照片量得台基約 0.35 個模距、一層約 1.2 個、二層約 1.22 個、簷口約 0.3 個、" +
  "馬薩屋頂陡斜段約 1.05 個、緩斜段約 0.36 個換算，屋脊約 20 公尺、角塔頂約 22 公尺，各部高度均為推估值。";

export function buildTaipeiGuestHouse(): Feature[] {
  const ring = outline(TAIPEI_GUEST_HOUSE);
  // 正面朝南，南面因車寄與凸出量體分成數段，取其中最長的一段；北面臨日式庭園，為最長的一道外牆
  const { frame: front, length: frontLength } = faceFrame(ring, towards(ring, -90), 12);
  const { frame: garden, length: gardenLength } = faceFrame(ring, towards(ring, 90), 20);

  const bay = gardenLength / GARDEN_BAYS;
  const plinth = bay * PLINTH_RATIO;
  const firstTop = plinth + bay * FIRST_RATIO;
  const secondTop = firstTop + bay * SECOND_RATIO;
  const corniceTop = secondTop + bay * CORNICE_RATIO;
  const steep = bay * MANSARD_STEEP_RATIO;
  const flat = bay * MANSARD_FLAT_RATIO;
  const ridgeBase = corniceTop + steep;
  const ridgeTop = ridgeBase + flat;

  const name = "臺北賓館";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("taipei-guest-house", GUEST_HOUSE_NOTE, input));
  };

  // 牆身：石造台基、一層、腰線、二層與出挑的簷口
  add({
    id: "base",
    name: `${name} 台基`,
    polygon: insetRing(ring, -0.7),
    base: 0,
    height: plinth,
  });
  add({
    id: "ground",
    name: `${name} 一層牆身`,
    polygon: ring,
    base: plinth,
    height: firstTop - plinth,
  });
  add({
    id: "belt",
    name: `${name} 腰線`,
    polygon: insetRing(ring, -0.4),
    base: firstTop - 0.45,
    height: 0.9,
  });
  add({
    id: "second",
    name: `${name} 二層牆身`,
    polygon: insetRing(ring, 0.2),
    base: firstTop,
    height: secondTop - firstTop,
  });
  add({
    id: "cornice",
    name: `${name} 簷口`,
    polygon: insetRing(ring, -0.9),
    base: secondTop,
    height: corniceTop - secondTop,
  });

  // 馬薩式屋頂：陡斜的下段、緩斜的上段，再以屋脊平臺與鑄鐵欄杆收頭
  add({
    id: "roof/slope/lower",
    name: `${name} 馬薩屋頂陡斜段`,
    polygon: insetRing(ring, 0.2),
    polygonTop: insetRing(ring, STEEP_TOP_INSET),
    base: corniceTop,
    height: steep,
  });
  add({
    id: "roof/slope/upper",
    name: `${name} 馬薩屋頂緩斜段`,
    polygon: insetRing(ring, STEEP_TOP_INSET),
    polygonTop: insetRing(ring, FLAT_TOP_INSET),
    base: ridgeBase,
    height: flat,
  });
  add({
    id: "roof/ridge",
    name: `${name} 屋脊平臺`,
    polygon: insetRing(ring, FLAT_TOP_INSET),
    base: ridgeTop,
    height: 0.3,
  });
  add({
    id: "roof/rail",
    name: `${name} 屋脊欄杆`,
    polygon: insetRing(ring, FLAT_TOP_INSET - 0.4),
    base: ridgeTop + 0.3,
    height: bay * RIDGE_RAIL_RATIO,
  });

  // 老虎窗：北面取四個開間的中線，南面取正面兩端，中央另有一座較高的山頭式老虎窗
  // lateral 為負即退入屋面，老虎窗因而立在陡斜段上而非懸在簷外
  const dormerBase = corniceTop + 0.3;
  const dormerHeight = steep * 0.72;
  for (let i = 1; i <= 4; i++) {
    add({
      id: `roof/dormer/garden/${i}`,
      name: `${name} 老虎窗`,
      polygon: rect(garden, -gardenLength / 2 + (i + 0.5) * bay, -1.0, 1.9, 2.0),
      base: dormerBase,
      height: dormerHeight,
    });
  }
  for (const side of [-1, 1]) {
    add({
      id: `roof/dormer/front/${side < 0 ? "l" : "r"}`,
      name: `${name} 老虎窗`,
      polygon: rect(front, side * (frontLength / 2 - 1.6), -1.0, 1.9, 2.0),
      base: dormerBase,
      height: dormerHeight,
    });
  }
  add({
    id: "roof/dormer/front/centre",
    name: `${name} 中央老虎窗`,
    polygon: rect(front, 0, -0.8, 3.4, 2.4),
    base: corniceTop + 0.2,
    height: steep * 0.95,
  });

  // 北面柱廊：一層為拱廊墩，二層為羅馬雙柱，柱頂承楣樑，陽臺外緣設欄杆
  for (let i = 0; i <= GARDEN_BAYS; i++) {
    const along = -gardenLength / 2 + i * bay;
    add({
      id: `arcade/pier/${i}`,
      name: `${name} 拱廊墩`,
      polygon: rect(garden, along, 0.2, 1.0, 1.2),
      base: plinth,
      height: firstTop - plinth - 0.4,
    });
    for (const side of [-1, 1]) {
      add({
        id: `colonnade/column/${i}/${side < 0 ? "l" : "r"}`,
        name: `${name} 陽臺雙柱`,
        polygon: rect(garden, along + side * 0.45, 0.25, 0.5, 0.5),
        base: firstTop + 0.25,
        height: secondTop - firstTop - 0.95,
      });
    }
  }
  add({
    id: "colonnade/entablature",
    name: `${name} 柱廊楣樑`,
    polygon: rect(garden, 0, 0.3, gardenLength + 0.9, 1.2),
    base: secondTop - 0.7,
    height: 0.7,
  });
  add({
    id: "colonnade/balustrade",
    name: `${name} 陽臺欄杆`,
    polygon: rect(garden, 0, 0.5, gardenLength, 0.3),
    base: firstTop,
    height: 1.05,
  });

  // 車寄：四柱撐起的車道頂蓋，頂面即二層的陽臺
  const deckBase = firstTop - 0.7;
  for (const along of [-1, 1]) {
    for (const depth of [0.9, PORTE_DEPTH - 0.7]) {
      add({
        id: `porch/column/${along < 0 ? "l" : "r"}/${depth < 2 ? "in" : "out"}`,
        name: `${name} 車寄柱`,
        polygon: rect(front, along * (PORTE_LENGTH / 2 - 0.6), depth, 0.75, 0.75),
        base: 0,
        height: deckBase,
      });
    }
  }
  add({
    id: "porch/deck",
    name: `${name} 車寄頂蓋`,
    polygon: rect(front, 0, PORTE_DEPTH / 2, PORTE_LENGTH, PORTE_DEPTH),
    base: deckBase,
    height: 0.7,
  });
  add({
    id: "porch/balustrade",
    name: `${name} 車寄欄杆`,
    polygon: rect(front, 0, PORTE_DEPTH - 0.15, PORTE_LENGTH, 0.3),
    base: firstTop,
    height: 1.0,
  });
  add({
    id: "pediment",
    name: `${name} 中央山頭`,
    polygon: rect(front, 0, 0.3, frontLength * 0.62, 1.4),
    polygonTop: rect(front, 0, 0.3, frontLength * 0.16, 1.4),
    base: secondTop + 0.4,
    height: bay * 0.9,
  });

  // 兩端角塔：塔身與圓頂各以正交與斜交的兩個方形疊成八角，頂上收至尖飾
  const drumTop = corniceTop + bay * TOWER_DRUM_RATIO;
  const domeTop = drumTop + bay * TOWER_DOME_RATIO;
  for (const side of [-1, 1]) {
    const origin = point(garden, side * (gardenLength / 2 - 1.5), -TOWER_INSET);
    const label = side < 0 ? "l" : "r";
    for (const turn of [0, 45]) {
      const frame: Frame = { origin, bearing: garden.bearing + turn };
      const suffix = turn === 0 ? "" : "-diagonal";
      add({
        id: `tower/${label}/drum${suffix}`,
        name: `${name} 角塔塔身`,
        polygon: rect(frame, 0, 0, TOWER_SIZE, TOWER_SIZE),
        base: corniceTop,
        height: drumTop - corniceTop,
      });
      add({
        id: `tower/${label}/dome${suffix}`,
        name: `${name} 角塔圓頂`,
        polygon: rect(frame, 0, 0, TOWER_SIZE, TOWER_SIZE),
        polygonTop: rect(frame, 0, 0, TOWER_SIZE * 0.3, TOWER_SIZE * 0.3),
        base: drumTop,
        height: domeTop - drumTop,
      });
    }
    add({
      id: `tower/${label}/finial`,
      name: `${name} 角塔尖飾`,
      polygon: rect({ origin, bearing: garden.bearing }, 0, 0, 0.9, 0.9),
      polygonTop: rect({ origin, bearing: garden.bearing }, 0, 0, 0.25, 0.25),
      base: domeTop,
      height: bay * TOWER_FINIAL_RATIO,
    });
  }
  return parts;
}

export function claim(): Local[] {
  return outline(TAIPEI_GUEST_HOUSE);
}
