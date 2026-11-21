/** 艋舺龍山寺：三進四合院的前殿、正殿與後殿，重簷歇山屋面與轎頂式鐘鼓樓。 */
import type { Local } from "../../../geo/project.ts";
import type { Feature } from "../../schema.ts";
import {
  minAreaRect,
  outline,
  part,
  point,
  rect,
  shift,
  type Frame,
  type PartInput,
} from "./frame.ts";

export const LONGSHAN_TEMPLE = "way/198401478";

const SLUG = "longshan-temple";

/**
 * 三進與中庭的進深，皆為最小外接矩形長度（南北向進深）的比例，
 * 自南而北依序為廟埕、前殿、中庭、正殿、後殿。
 */
const PLAZA_DEPTH = 0.14;
const FRONT_DEPTH = 0.18;
const COURT_DEPTH = 0.16;
const MAIN_DEPTH = 0.26;
const REAR_DEPTH = 0.22;

/** 各進的面寬，皆為最小外接矩形寬度（東西向面寬）的比例。 */
const FRONT_WIDTH = 0.95;
const REAR_WIDTH = 0.92;
/** 正殿殿身與其外的走馬廊。 */
const MAIN_WIDTH = 0.52;
const VERANDA_WIDTH = 0.7;
/** 東西廂廊的廊寬與鐘鼓樓的邊長。 */
const WING_WIDTH = 0.11;
const TOWER_WIDTH = 0.15;
/** 前殿為十一開間，中央三川殿占五間、兩側龍門廳與虎門廳各占三間。 */
const FRONT_BAYS = 11;
const CENTRE_BAYS = 5;
const SIDE_BAYS = 3;

/** 廟埕鋪面、各進台基與牆身的高程（公尺，地面為 0）。 */
const PLAZA_TOP = 0.3;
const PODIUM_TOP = 0.9;
const FRONT_WALL_TOP = 5.5;
const FRONT_CLERESTORY_BASE = 7.1;
const FRONT_CLERESTORY_TOP = 9.1;
const MAIN_PODIUM_TOP = 1.2;
const MAIN_VERANDA_TOP = 6.2;
const MAIN_CLERESTORY_BASE = 7.8;
const MAIN_CLERESTORY_TOP = 11.8;
const REAR_PODIUM_TOP = 1.0;
const REAR_WALL_TOP = 6.0;
const WING_WALL_TOP = 4.3;
const TOWER_BODY_TOP = 7.4;
const TOWER_UPPER_BASE = 8.6;
const TOWER_UPPER_TOP = 10.2;

/** 簷口厚度與正脊高度（公尺）；閩南式屋面出簷深、脊帶厚實。 */
const EAVE_THICKNESS = 0.45;
const RIDGE_HEIGHT = 0.55;

const NOTE =
  "艋舺龍山寺創建於清乾隆三年（1738 年），1920 年由王益順主持改建為宮殿式三進四合院，" +
  "正殿 1945 年毀於臺北大空襲，1953 年起由王益順姪孫王世南依原規制重建（中文維基百科「艋舺龍山寺」條目）。" +
  "坐北朝南，前殿十一開間分為三川殿與龍門廳、虎門廳，上覆重簷歇山頂並立銅鑄龍柱，" +
  "兩端為轎頂式鐘鼓樓，正殿四面走馬廊、重簷歇山立於迴廊之中，後殿面寬最寬、單簷歇山。" +
  "平面取自 OSM 輪廓 way/198401478 的最小外接矩形（進深約 52 公尺、面寬約 40 公尺），" +
  "各進的進深與開間寬度依此比例分配。條目未載總高，各部高度依正立面照片以面寬 40 公尺為比例尺換算：" +
  "前殿上簷正脊約 12.6 公尺、鐘鼓樓寶頂約 14.9 公尺、正殿正脊約 16.3 公尺、後殿正脊約 9.3 公尺，均為推估值。";

interface RoofInput {
  id: string;
  name: string;
  along: number;
  lateral: number;
  /** 簷口的進深與面寬。 */
  length: number;
  width: number;
  base: number;
  /** 各斜段的升高；下緩上陡即成閩南式的凹曲屋面。 */
  rises: number[];
  /** 斜面收至簷口尺寸的比例：正脊沿面寬方向，故進深收得快、面寬收得慢。 */
  taperLength: number;
  taperWidth: number;
}

type Emit = (input: PartInput) => void;

/** 簷口與其上逐段內縮的斜面；回傳脊座高程與脊座尺寸，供正脊與燕尾接續。 */
function roofStack(
  frame: Frame,
  add: Emit,
  input: RoofInput,
): { top: number; length: number; width: number } {
  add({
    id: `${input.id}/eave`,
    name: `${input.name}簷口`,
    polygon: rect(frame, input.along, input.lateral, input.length, input.width),
    base: input.base,
    height: EAVE_THICKNESS,
  });
  let level = input.base + EAVE_THICKNESS;
  let lower = { length: input.length, width: input.width };
  input.rises.forEach((rise, i) => {
    const t = (i + 1) / input.rises.length;
    const upper = {
      length: input.length * (1 + (input.taperLength - 1) * t),
      width: input.width * (1 + (input.taperWidth - 1) * t),
    };
    add({
      id: `${input.id}/slope/${i}`,
      name: `${input.name}屋面`,
      polygon: rect(frame, input.along, input.lateral, lower.length, lower.width),
      polygonTop: rect(frame, input.along, input.lateral, upper.length, upper.width),
      base: level,
      height: rise,
    });
    level += rise;
    lower = upper;
  });
  return { top: level, length: lower.length, width: lower.width };
}

/** 正脊與兩端向外上方翹起的燕尾；脊帶沿面寬方向，燕尾落在面寬的兩端。 */
function ridgeWithTails(
  frame: Frame,
  add: Emit,
  input: {
    id: string;
    name: string;
    along: number;
    lateral: number;
    length: number;
    width: number;
    base: number;
    reach: number;
  },
): void {
  add({
    id: `${input.id}/ridge`,
    name: `${input.name}正脊`,
    polygon: rect(frame, input.along, input.lateral, input.length, input.width),
    base: input.base,
    height: RIDGE_HEIGHT,
  });
  for (const side of [-1, 1]) {
    const lateral = input.lateral + side * (input.width / 2 + input.reach / 3);
    add({
      id: `${input.id}/tail/${side > 0 ? "east" : "west"}`,
      name: `${input.name}燕尾`,
      polygon: rect(frame, input.along, lateral, input.length, input.reach),
      polygonTop: shift(
        rect(frame, input.along, lateral, input.length * 0.7, input.reach * 0.6),
        frame,
        0,
        side * input.reach,
      ),
      base: input.base - 0.1,
      height: RIDGE_HEIGHT + input.reach * 0.7,
    });
  }
}

export function buildLongshanTemple(): Feature[] {
  const ring = outline(LONGSHAN_TEMPLE);
  const axis = minAreaRect(ring);
  // 坐北朝南：長軸為進深方向，取 along 為正者朝南的座標系，長軸指向北側時反向
  const probe = point({ origin: axis.center, bearing: axis.bearing }, 1, 0);
  const southward = probe[1] < axis.center[1];
  const frame: Frame = {
    origin: axis.center,
    bearing: southward ? axis.bearing : axis.bearing + 180,
  };
  // 龍邊（面南時的左側）為東，鐘樓在東、鼓樓在西
  const east = point(frame, 0, 1)[0] > frame.origin[0] ? 1 : -1;
  const L = axis.length;
  const W = axis.width;
  const name = "艋舺龍山寺";
  const parts: Feature[] = [];
  const add: Emit = (input) => {
    parts.push(part(SLUG, NOTE, input));
  };

  // 自南緣往北依序排定各進的中心位置
  const south = L / 2;
  const plazaAlong = south - (PLAZA_DEPTH / 2) * L;
  const frontAlong = south - (PLAZA_DEPTH + FRONT_DEPTH / 2) * L;
  const mainAlong = south - (PLAZA_DEPTH + FRONT_DEPTH + COURT_DEPTH + MAIN_DEPTH / 2) * L;
  const rearAlong =
    south - (PLAZA_DEPTH + FRONT_DEPTH + COURT_DEPTH + MAIN_DEPTH + REAR_DEPTH / 2) * L;
  const frontLength = FRONT_DEPTH * L;
  const frontWidth = FRONT_WIDTH * W;
  const mainLength = MAIN_DEPTH * L;
  const rearLength = REAR_DEPTH * L;
  const rearWidth = REAR_WIDTH * W;
  const tower = TOWER_WIDTH * W;

  // 廟埕：山門前的鋪面台座，略高於街面
  add({
    id: "plaza",
    name: `${name} 廟埕台基`,
    polygon: rect(frame, plazaAlong, 0, PLAZA_DEPTH * L, W),
    base: 0,
    height: PLAZA_TOP,
  });

  // 前殿（三川殿、龍門廳、虎門廳）：台基、十一開間的牆身與入口銅鑄龍柱
  add({
    id: "front/podium",
    name: `${name} 前殿台基`,
    polygon: rect(frame, frontAlong, 0, frontLength + 2.0, frontWidth + 2.0),
    base: 0,
    height: PODIUM_TOP,
  });
  const bay = frontWidth / FRONT_BAYS;
  const bays: { id: string; label: string; lateral: number; width: number }[] = [
    { id: "centre", label: "三川殿", lateral: 0, width: CENTRE_BAYS * bay },
    {
      id: "dragon",
      label: "龍門廳",
      lateral: east * ((CENTRE_BAYS + SIDE_BAYS) / 2) * bay,
      width: SIDE_BAYS * bay,
    },
    {
      id: "tiger",
      label: "虎門廳",
      lateral: -east * ((CENTRE_BAYS + SIDE_BAYS) / 2) * bay,
      width: SIDE_BAYS * bay,
    },
  ];
  for (const unit of bays) {
    add({
      id: `front/wall/${unit.id}`,
      name: `${name} ${unit.label}牆身`,
      polygon: rect(frame, frontAlong, unit.lateral, frontLength, unit.width),
      base: PODIUM_TOP,
      height: FRONT_WALL_TOP - PODIUM_TOP,
    });
  }
  for (const side of [-1, 1]) {
    add({
      id: `front/column/${side * east > 0 ? "east" : "west"}`,
      name: `${name} 三川殿龍柱`,
      polygon: rect(frame, frontAlong + frontLength / 2 - 0.6, side * bay, 1.0, 1.0),
      base: PODIUM_TOP,
      height: FRONT_WALL_TOP - PODIUM_TOP - 0.6,
    });
  }
  // 前殿重簷：下簷環繞步口廊，上簷立於較窄的上層牆之上
  const frontLower = roofStack(frame, add, {
    id: "front/lower",
    name: `${name} 前殿下簷`,
    along: frontAlong,
    lateral: 0,
    length: frontLength + 3.2,
    width: frontWidth + 3.2,
    base: FRONT_WALL_TOP,
    rises: [0.95, 0.75],
    taperLength: 0.62,
    taperWidth: 0.93,
  });
  const frontUpperWidth = 0.72 * frontWidth;
  add({
    id: "front/clerestory",
    name: `${name} 前殿上層牆`,
    polygon: rect(frame, frontAlong, 0, frontLower.length * 0.9, frontUpperWidth),
    base: FRONT_CLERESTORY_BASE,
    height: FRONT_CLERESTORY_TOP - FRONT_CLERESTORY_BASE,
  });
  const frontUpper = roofStack(frame, add, {
    id: "front/upper",
    name: `${name} 前殿上簷`,
    along: frontAlong,
    lateral: 0,
    length: frontLower.length * 0.9 + 2.6,
    width: frontUpperWidth + 2.6,
    base: FRONT_CLERESTORY_TOP,
    rises: [1.0, 0.85, 0.6],
    taperLength: 0.16,
    taperWidth: 0.5,
  });
  ridgeWithTails(frame, add, {
    id: "front",
    name: `${name} 前殿`,
    along: frontAlong,
    lateral: 0,
    length: frontUpper.length,
    width: frontUpper.width,
    base: frontUpper.top,
    reach: 1.6,
  });

  // 鐘樓與鼓樓：前殿兩端的轎頂式樓閣，上下兩層樓身各帶一重簷，頂為攢尖加寶頂
  const towerAlong = frontAlong - frontLength / 2 + tower / 2;
  const towerLateral = frontWidth / 2 - tower / 2;
  for (const unit of [
    { id: "bell", label: "鐘樓", side: east },
    { id: "drum", label: "鼓樓", side: -east },
  ]) {
    const lateral = unit.side * towerLateral;
    add({
      id: `tower/${unit.id}/body`,
      name: `${name} ${unit.label}樓身`,
      polygon: rect(frame, towerAlong, lateral, tower, tower),
      base: PODIUM_TOP,
      height: TOWER_BODY_TOP - PODIUM_TOP,
    });
    roofStack(frame, add, {
      id: `tower/${unit.id}/lower`,
      name: `${name} ${unit.label}下簷`,
      along: towerAlong,
      lateral,
      length: tower + 1.8,
      width: tower + 1.8,
      base: TOWER_BODY_TOP,
      rises: [0.8],
      taperLength: 0.8,
      taperWidth: 0.8,
    });
    add({
      id: `tower/${unit.id}/upper`,
      name: `${name} ${unit.label}上層樓身`,
      polygon: rect(frame, towerAlong, lateral, tower * 0.8, tower * 0.8),
      base: TOWER_UPPER_BASE,
      height: TOWER_UPPER_TOP - TOWER_UPPER_BASE,
    });
    // 轎頂式即攢尖頂：四面等收，愈近頂端愈陡
    const cap = roofStack(frame, add, {
      id: `tower/${unit.id}/cap`,
      name: `${name} ${unit.label}轎頂`,
      along: towerAlong,
      lateral,
      length: tower * 0.8 + 1.6,
      width: tower * 0.8 + 1.6,
      base: TOWER_UPPER_TOP,
      rises: [1.5, 1.2, 0.8],
      taperLength: 0.15,
      taperWidth: 0.15,
    });
    add({
      id: `tower/${unit.id}/finial`,
      name: `${name} ${unit.label}寶頂`,
      polygon: rect(frame, towerAlong, lateral, cap.length, cap.width),
      polygonTop: rect(frame, towerAlong, lateral, cap.length * 0.4, cap.width * 0.4),
      base: cap.top,
      height: 0.7,
    });
  }

  // 東西廂廊：沿中庭與正殿兩側的迴廊，單坡低矮
  const wingAlong = south - (PLAZA_DEPTH + FRONT_DEPTH + (COURT_DEPTH + MAIN_DEPTH) / 2) * L;
  const wingLength = (COURT_DEPTH + MAIN_DEPTH) * L;
  const wingWidth = WING_WIDTH * W;
  for (const side of [-1, 1]) {
    const label = side * east > 0 ? "東" : "西";
    const lateral = side * (W / 2 - wingWidth / 2);
    add({
      id: `wing/${side * east > 0 ? "east" : "west"}/wall`,
      name: `${name} ${label}廂廊`,
      polygon: rect(frame, wingAlong, lateral, wingLength, wingWidth),
      base: PODIUM_TOP,
      height: WING_WALL_TOP - PODIUM_TOP,
    });
    roofStack(frame, add, {
      id: `wing/${side * east > 0 ? "east" : "west"}/roof`,
      name: `${name} ${label}廂廊`,
      along: wingAlong,
      lateral,
      length: wingLength + 1.6,
      width: wingWidth + 1.6,
      base: WING_WALL_TOP,
      rises: [0.8, 0.6],
      taperLength: 0.95,
      taperWidth: 0.3,
    });
  }

  // 正殿（圓通寶殿）：高台基、四面走馬廊與重簷歇山，為全寺最高一進
  add({
    id: "main/podium",
    name: `${name} 正殿台基`,
    polygon: rect(frame, mainAlong, 0, mainLength + 2.4, VERANDA_WIDTH * W + 2.4),
    base: 0,
    height: MAIN_PODIUM_TOP,
  });
  add({
    id: "main/veranda",
    name: `${name} 正殿走馬廊`,
    polygon: rect(frame, mainAlong, 0, mainLength, VERANDA_WIDTH * W),
    base: MAIN_PODIUM_TOP,
    height: MAIN_VERANDA_TOP - MAIN_PODIUM_TOP,
  });
  add({
    id: "main/hall",
    name: `${name} 正殿殿身`,
    polygon: rect(frame, mainAlong, 0, mainLength * 0.7, MAIN_WIDTH * W),
    base: MAIN_PODIUM_TOP,
    height: MAIN_CLERESTORY_BASE - MAIN_PODIUM_TOP,
  });
  const mainLower = roofStack(frame, add, {
    id: "main/lower",
    name: `${name} 正殿下簷`,
    along: mainAlong,
    lateral: 0,
    length: mainLength + 2.8,
    width: VERANDA_WIDTH * W + 2.8,
    base: MAIN_VERANDA_TOP,
    rises: [1.0, 0.8],
    taperLength: 0.72,
    taperWidth: 0.92,
  });
  // 下簷四角的翼角：簷口沿對角微微上揚
  for (const sa of [-1, 1]) {
    for (const sl of [-1, 1]) {
      const along = mainAlong + sa * (mainLower.length / 2 - 1.0);
      const lateral = sl * (mainLower.width / 2 - 1.0);
      add({
        id: `main/corner/${sa > 0 ? "s" : "n"}${sl * east > 0 ? "e" : "w"}`,
        name: `${name} 正殿翼角`,
        polygon: rect(frame, along, lateral, 2.0, 2.0),
        polygonTop: shift(rect(frame, along, lateral, 1.1, 1.1), frame, sa * 1.2, sl * 1.2),
        base: MAIN_VERANDA_TOP + EAVE_THICKNESS - 0.2,
        height: 1.2,
      });
    }
  }
  add({
    id: "main/clerestory",
    name: `${name} 正殿上層牆`,
    polygon: rect(frame, mainAlong, 0, mainLength * 0.56, MAIN_WIDTH * W),
    base: MAIN_CLERESTORY_BASE,
    height: MAIN_CLERESTORY_TOP - MAIN_CLERESTORY_BASE,
  });
  const mainUpper = roofStack(frame, add, {
    id: "main/upper",
    name: `${name} 正殿上簷`,
    along: mainAlong,
    lateral: 0,
    length: mainLength * 0.56 + 2.6,
    width: MAIN_WIDTH * W + 2.6,
    base: MAIN_CLERESTORY_TOP,
    rises: [1.4, 1.2, 0.9],
    taperLength: 0.18,
    taperWidth: 0.5,
  });
  ridgeWithTails(frame, add, {
    id: "main",
    name: `${name} 正殿`,
    along: mainAlong,
    lateral: 0,
    length: mainUpper.length,
    width: mainUpper.width,
    base: mainUpper.top,
    reach: 1.8,
  });

  // 後殿：面寬最寬的一進，單簷歇山
  add({
    id: "rear/podium",
    name: `${name} 後殿台基`,
    polygon: rect(frame, rearAlong, 0, rearLength + 2.0, rearWidth + 2.0),
    base: 0,
    height: REAR_PODIUM_TOP,
  });
  add({
    id: "rear/wall",
    name: `${name} 後殿牆身`,
    polygon: rect(frame, rearAlong, 0, rearLength, rearWidth),
    base: REAR_PODIUM_TOP,
    height: REAR_WALL_TOP - REAR_PODIUM_TOP,
  });
  const rearRoof = roofStack(frame, add, {
    id: "rear/roof",
    name: `${name} 後殿`,
    along: rearAlong,
    lateral: 0,
    length: rearLength + 2.6,
    width: rearWidth + 2.6,
    base: REAR_WALL_TOP,
    rises: [1.3, 1.0],
    taperLength: 0.12,
    taperWidth: 0.55,
  });
  ridgeWithTails(frame, add, {
    id: "rear",
    name: `${name} 後殿`,
    along: rearAlong,
    lateral: 0,
    length: rearRoof.length,
    width: rearRoof.width,
    base: rearRoof.top,
    reach: 1.6,
  });

  return parts;
}

export function claim(): Local[] {
  return outline(LONGSHAN_TEMPLE);
}
