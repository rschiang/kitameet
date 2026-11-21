/** 艋舺青山宮：街屋式三進廟宇，前殿重簷歇山、正殿硬山，後殿為三層樓閣。 */
import type { Local } from "../../../geo/project.ts";
import type { Feature } from "../../schema.ts";
import {
  faceFrame,
  insetRing,
  minAreaRect,
  outline,
  part,
  rect,
  shift,
  towards,
  type PartInput,
} from "./frame.ts";

export const QINGSHAN_TEMPLE = "way/545805290";

/** 三進各佔進深的比例；街屋式廟宇的中埕狹長，正殿一進最深。 */
const FRONT_SHARE = 0.24;
const MAIN_SHARE = 0.4;

/** 台基與前埕階台的高度（公尺）。 */
const PODIUM = 0.5;
const STEP = 0.35;
/** 簷口厚度與出挑（公尺）。 */
const EAVE_THICKNESS = 0.45;
const EAVE_REACH = 1.1;
/** 正脊厚度（公尺）。 */
const RIDGE_THICKNESS = 0.55;
/** 前殿（三川殿）重簷各段的高程（公尺）。 */
const FRONT_WALL_TOP = 5.4;
const FRONT_CLERESTORY_TOP = 8.3;
const FRONT_ROOF_RISE = 2.3;
/** 正殿一進抬高台基後的各段高程（公尺）。 */
const MAIN_PODIUM = 0.95;
const MAIN_WALL_TOP = 7.2;
const MAIN_CLERESTORY_TOP = 9.6;
const MAIN_ROOF_RISE = 2.5;
/** 後殿三層樓閣的層高、腰線與屋頂（公尺）。 */
const REAR_STOREYS = 3;
const REAR_STOREY = 3.9;
const REAR_BAND = 0.35;
const REAR_CORNICE = 0.6;
const REAR_ROOF_RISE = 3.4;
/** 護龍牆（兩廊外牆）的厚度與高度（公尺）。 */
const WING_THICKNESS = 0.9;
const WING_TOP = 5.2;

const QINGSHAN_NOTE =
  "艋舺青山宮肇建於 1856 年（咸豐 6 年）、1859 年落成，坐南朝北面臨貴陽街，" +
  "為三開間、三進兩廊的街屋式廟宇（中文維基百科「艋舺青山宮」條目）：" +
  "前殿為重簷歇山頂，拜殿臺基抬高與正殿齊平、屋頂並與正殿硬山頂相連，" +
  "後殿為 1979 年改建的地下一層、地上三層鋼筋混凝土樓閣式建築，為全廟最高的一進。" +
  "平面取自 OSM 輪廓，進深與面寬由最小外接矩形取得，朝北的外牆為立面基準。" +
  "條目未載總高，各部高度依維基共享資源的三川殿正立面照片，以面寬 17.9 公尺（輪廓短邊）為比例尺換算：" +
  "前殿正脊約為面寬的 0.65 倍、正殿再高約 1.5 公尺，後殿三層每層約 3.9 公尺另加簷口與屋頂約 4 公尺，" +
  "最高點約 17.3 公尺，均為推估值。";

export function buildQingshanTemple(): Feature[] {
  const ring = outline(QINGSHAN_TEMPLE);
  const axis = minAreaRect(ring);
  // 正面臨貴陽街：取朝北的外牆為立面基準，lateral 朝街為正、朝廟內為負
  const { frame, length: facade } = faceFrame(ring, towards(ring, 90), 12);
  // 進深為輪廓中與面寬不同的那個方向，不預設長短邊何者為正面
  const depth =
    Math.abs(axis.length - facade) <= Math.abs(axis.width - facade) ? axis.width : axis.length;
  const name = "艋舺青山宮";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("qingshan-temple", QINGSHAN_NOTE, input));
  };

  const frontDepth = depth * FRONT_SHARE;
  const mainDepth = depth * MAIN_SHARE;
  const rearDepth = depth - frontDepth - mainDepth;
  const frontCenter = -frontDepth / 2;
  const mainCenter = -(frontDepth + mainDepth / 2);
  const rearCenter = -(frontDepth + mainDepth + rearDepth / 2);
  const wallSpan = facade - 1.2;

  /**
   * 一進的屋頂：兩段凹曲屋面、正脊與兩端燕尾。
   * `hip` 為每段屋面在面寬方向的收分，歇山頂取正值、硬山頂取 0。
   */
  const addRoof = (
    id: string,
    lateral: number,
    span: number,
    reach: number,
    base: number,
    rise: number,
    hip: number,
  ): void => {
    // 閩南式屋面為凹曲：下段緩而寬、上段陡而窄
    const midSpan = span - hip;
    const midReach = reach * 0.52;
    const ridgeSpan = span - 2 * hip;
    const ridgeReach = Math.max(reach * 0.16, 1.0);
    add({
      id: `${id}/slope/0`,
      name: `${name} 屋面`,
      polygon: rect(frame, 0, lateral, span, reach),
      polygonTop: rect(frame, 0, lateral, midSpan, midReach),
      base,
      height: rise * 0.55,
    });
    add({
      id: `${id}/slope/1`,
      name: `${name} 屋面`,
      polygon: rect(frame, 0, lateral, midSpan, midReach),
      polygonTop: rect(frame, 0, lateral, ridgeSpan, ridgeReach),
      base: base + rise * 0.55,
      height: rise * 0.45,
    });
    const ridgeBase = base + rise;
    add({
      id: `${id}/ridge`,
      name: `${name} 正脊`,
      polygon: rect(frame, 0, lateral, ridgeSpan, 0.85),
      base: ridgeBase,
      height: RIDGE_THICKNESS,
    });
    // 燕尾：正脊兩端向外上方翹起
    for (const side of [-1, 1]) {
      const along = side * (ridgeSpan / 2 + 0.35);
      add({
        id: `${id}/tail/${side < 0 ? 0 : 1}`,
        name: `${name} 燕尾`,
        polygon: rect(frame, along, lateral, 1.5, 0.9),
        polygonTop: shift(rect(frame, along, lateral, 1.0, 0.6), frame, side * 1.6, 0),
        base: ridgeBase - 0.15,
        height: 1.25,
      });
    }
  };

  // 台基與臨街的前埕階台
  add({
    id: "base/podium",
    name: `${name} 台基`,
    polygon: insetRing(ring, -0.3),
    base: 0,
    height: PODIUM,
  });
  add({
    id: "base/step",
    name: `${name} 前埕階台`,
    polygon: rect(frame, 0, 1.6, wallSpan * 0.7, 2.2),
    base: 0,
    height: STEP,
  });

  // 前殿：三川門牌樓面略突出於立面，上下兩層簷之間為「敕封大宋明神」匾帶
  add({
    id: "front/wall",
    name: `${name} 前殿牆身`,
    polygon: rect(frame, 0, frontCenter, wallSpan, frontDepth),
    base: PODIUM,
    height: FRONT_WALL_TOP - PODIUM,
  });
  add({
    id: "front/gate",
    name: `${name} 前殿牌樓面`,
    polygon: rect(frame, 0, 0.25, wallSpan * 0.62, 1.4),
    base: PODIUM,
    height: FRONT_WALL_TOP - PODIUM + 0.3,
  });
  add({
    id: "front/eave/lower",
    name: `${name} 前殿下簷`,
    polygon: rect(
      frame,
      0,
      frontCenter,
      wallSpan + 2 * EAVE_REACH,
      frontDepth + 2 * EAVE_REACH,
    ),
    base: FRONT_WALL_TOP,
    height: EAVE_THICKNESS,
  });
  add({
    id: "front/clerestory",
    name: `${name} 前殿重簷牆身`,
    polygon: rect(frame, 0, frontCenter, wallSpan - 2.4, frontDepth - 2.4),
    base: FRONT_WALL_TOP + EAVE_THICKNESS,
    height: FRONT_CLERESTORY_TOP - FRONT_WALL_TOP - EAVE_THICKNESS,
  });
  add({
    id: "front/eave/upper",
    name: `${name} 前殿上簷`,
    polygon: rect(frame, 0, frontCenter, wallSpan - 0.4, frontDepth - 0.4),
    base: FRONT_CLERESTORY_TOP,
    height: EAVE_THICKNESS,
  });
  addRoof(
    "front/roof",
    frontCenter,
    wallSpan - 0.4,
    frontDepth - 0.4,
    FRONT_CLERESTORY_TOP + EAVE_THICKNESS,
    FRONT_ROOF_RISE,
    1.8,
  );

  // 兩廊護龍牆：街屋式廟宇沒有開闊中庭，兩側以高牆夾住狹長的中埕
  for (const side of [-1, 1]) {
    add({
      id: `wing/${side < 0 ? 0 : 1}`,
      name: `${name} 護龍牆`,
      polygon: rect(
        frame,
        side * (facade / 2 - WING_THICKNESS / 2),
        mainCenter,
        WING_THICKNESS,
        mainDepth,
      ),
      base: PODIUM,
      height: WING_TOP - PODIUM,
    });
  }

  // 正殿一進：拜殿臺基抬高與正殿同高，屋頂相連為單一量體
  add({
    id: "main/podium",
    name: `${name} 正殿臺基`,
    polygon: rect(frame, 0, mainCenter, wallSpan + 0.6, mainDepth),
    base: PODIUM,
    height: MAIN_PODIUM,
  });
  add({
    id: "main/wall",
    name: `${name} 正殿牆身`,
    polygon: rect(frame, 0, mainCenter, wallSpan, mainDepth - 1.0),
    base: PODIUM + MAIN_PODIUM,
    height: MAIN_WALL_TOP - PODIUM - MAIN_PODIUM,
  });
  add({
    id: "main/eave/lower",
    name: `${name} 正殿下簷`,
    polygon: rect(
      frame,
      0,
      mainCenter,
      wallSpan + 2 * EAVE_REACH,
      mainDepth - 1.0 + 2 * EAVE_REACH,
    ),
    base: MAIN_WALL_TOP,
    height: EAVE_THICKNESS,
  });
  add({
    id: "main/clerestory",
    name: `${name} 正殿重簷牆身`,
    polygon: rect(frame, 0, mainCenter, wallSpan - 2.0, mainDepth - 4.0),
    base: MAIN_WALL_TOP + EAVE_THICKNESS,
    height: MAIN_CLERESTORY_TOP - MAIN_WALL_TOP - EAVE_THICKNESS,
  });
  add({
    id: "main/eave/upper",
    name: `${name} 正殿上簷`,
    polygon: rect(frame, 0, mainCenter, wallSpan, mainDepth - 2.6),
    base: MAIN_CLERESTORY_TOP,
    height: EAVE_THICKNESS,
  });
  // 硬山頂的山牆齊平於兩側，屋面只在進深方向收分
  addRoof(
    "main/roof",
    mainCenter,
    wallSpan,
    mainDepth - 2.6,
    MAIN_CLERESTORY_TOP + EAVE_THICKNESS,
    MAIN_ROOF_RISE,
    0,
  );

  // 後殿：三層樓閣逐層略收分，層間以腰線分隔
  for (let i = 0; i < REAR_STOREYS; i++) {
    const storeyBase = PODIUM + i * REAR_STOREY;
    add({
      id: `rear/storey/${i}`,
      name: `${name} 後殿樓身`,
      polygon: rect(frame, 0, rearCenter, wallSpan - i * 0.6, rearDepth - i * 0.8),
      base: storeyBase,
      height: REAR_STOREY,
    });
    if (i === REAR_STOREYS - 1) continue;
    add({
      id: `rear/band/${i}`,
      name: `${name} 後殿腰線`,
      polygon: rect(frame, 0, rearCenter, wallSpan - i * 0.6 + 0.7, rearDepth - i * 0.8 + 0.7),
      base: storeyBase + REAR_STOREY - REAR_BAND,
      height: REAR_BAND,
    });
  }
  const rearTop = PODIUM + REAR_STOREYS * REAR_STOREY;
  const rearSpan = wallSpan - (REAR_STOREYS - 1) * 0.6;
  const rearReach = rearDepth - (REAR_STOREYS - 1) * 0.8;
  add({
    id: "rear/cornice",
    name: `${name} 後殿簷口`,
    polygon: rect(frame, 0, rearCenter, rearSpan + 2 * EAVE_REACH, rearReach + 2 * EAVE_REACH),
    base: rearTop,
    height: REAR_CORNICE,
  });
  addRoof(
    "rear/roof",
    rearCenter,
    rearSpan + 1.4,
    rearReach + 1.4,
    rearTop + REAR_CORNICE,
    REAR_ROOF_RISE,
    1.2,
  );
  return parts;
}

export function claim(): Local[] {
  return outline(QINGSHAN_TEMPLE);
}
