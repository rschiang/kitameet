/** 行政院中央大樓（原臺北市役所）：四層現代主義官署，水平陽台帶、突出門廊與高起的中央入口量體。 */
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

export const EXECUTIVE_YUAN = "relation/7814100";

/** 台基、各層樓板、簷口與女兒牆的高程（公尺）。 */
const EY_PLINTH_TOP = 1.2;
const EY_GROUND_TOP = 4.6;
const EY_SECOND_TOP = 8.5;
const EY_THIRD_TOP = 12.4;
const EY_CORNICE_TOP = 13.2;
const EY_PARAPET_TOP = 14.6;
/** 正面中段四層與中央入口量體的高程（公尺）。 */
const EY_FOURTH_TOP = 16.3;
const EY_FOURTH_CORNICE_TOP = 17.0;
const EY_FOURTH_PARAPET_TOP = 18.2;
const EY_TOWER_TOP = 19.2;
const EY_TOWER_CAP_TOP = 20.0;
/** 中央集會堂屋頂與屋頂機房的高程（公尺）。 */
const EY_HALL_ROOF_TOP = 15.2;
const EY_PLANT_TOP = 15.6;
/** 門廊楣樑帶與其上露臺欄杆的高程（公尺）。 */
const EY_PORCH_FASCIA_BASE = 4.4;
const EY_PORCH_FASCIA_TOP = 5.5;
const EY_PORCH_RAIL_TOP = 6.5;
/** 中央入口一對柱子與其上水平遮陽板的高程（公尺）。 */
const EY_COLUMN_TOP = 11.8;
const EY_CANOPY_TOP = 12.7;
/** 陽台帶、簷口的出挑與各層收分（公尺）。 */
const EY_PLINTH_REACH = 1.0;
const EY_PLINTH_BATTER = 0.5;
const EY_BALCONY_REACH = 1.1;
const EY_BALCONY_THICKNESS = 0.5;
const EY_CORNICE_REACH = 0.9;
const EY_WALL_INSET = 0.25;
const EY_PARAPET_INSET = 0.2;
/** 柱列、角部壁體與門廊柱的斷面（公尺）。 */
const EY_COLONNADE_BAY = 5.2;
const EY_COLONNADE_SIZE = 1.2;
const EY_COLONNADE_REACH = 0.9;
const EY_CORNER_SIZE = 5.0;
const EY_PORCH_PIER = 2.8;
const EY_ENTRY_COLUMN = 1.4;
/**
 * 門廊面寬、四層、中央入口量體與集會堂的平面尺寸比例。
 * 以輪廓長邊（89.9 公尺）與正面退縮量為比例尺推算，避免另立座標常數。
 */
const EY_PORCH_WIDTH_RATIO = 0.15;
const EY_FOURTH_WIDTH_RATIO = 0.52;
const EY_FOURTH_DEPTH_RATIO = 0.62;
const EY_TOWER_WIDTH_RATIO = 0.17;
const EY_TOWER_DEPTH_RATIO = 0.4;
const EY_HALL_WIDTH_RATIO = 0.22;
const EY_HALL_DEPTH_RATIO = 0.52;
/** 屋頂機房的位置與尺寸，取主棟進深與長邊的比例。 */
const EY_PLANT_ALONG_RATIO = 0.26;
const EY_PLANT_LATERAL_RATIO = 0.18;
const EY_PLANT_WIDTH_RATIO = 0.1;
const EY_PLANT_DEPTH_RATIO = 0.16;

const EY_NOTE =
  "行政院中央大樓原為臺北市役所，1937 年起造、1940 年落成，總督府營繕課井手薰主持設計，" +
  "協志營造廠承造（中文維基百科「行政院中央大樓」條目）：鋼骨與鋼筋混凝土造，平面呈日字型，" +
  "四周為辦公室、中央為集會堂，外牆貼褐色二丁掛面磚，屋頂水平，立面強調簡潔方塊體與水平線條，" +
  "正立面左右對稱、門廊向外突出，中央入口各層各有一對柱子。" +
  "平面取自 OSM 輪廓，含南北兩面向外突出的門廊；主棟的長寬與正背面的退縮量由該輪廓的最小外接矩形與立面取得。" +
  "條目載棟高四層而未載總高，各部高度依正立面照片以輪廓長邊 89.9 公尺為比例尺換算：" +
  "三層翼樓的女兒牆頂約為長邊的六分之一、即 14.6 公尺，據此得一層 4.6 公尺、二三層各 3.9 公尺；" +
  "四層僅覆蓋正面中段（條目載四樓樓地板 234 坪，約為一樓 1,122 坪的五分之一），" +
  "中央入口量體再高起一層，全高約 20 公尺。各部高度與門廊、柱列的斷面均為推估值。";

/**
 * 將正立面座標系移到輪廓中線上，並取得該牆面距輪廓中心的距離。
 * 南北兩面都受突出的門廊切成兩段，`faceFrame` 取回的只是其中一段，
 * 直接以該段放樣會使車寄與柱列偏向一側。
 */
function facePlane(face: Frame, centre: Local): { frame: Frame; setback: number } {
  const rad = (face.bearing * Math.PI) / 180;
  const dx = centre[0] - face.origin[0];
  const dy = centre[1] - face.origin[1];
  const along = dx * Math.cos(rad) + dy * Math.sin(rad);
  const lateral = -dx * Math.sin(rad) + dy * Math.cos(rad);
  return { frame: { origin: point(face, along, 0), bearing: face.bearing }, setback: Math.abs(lateral) };
}

export function buildExecutiveYuan(): Feature[] {
  const ring = outline(EXECUTIVE_YUAN);
  const axis = minAreaRect(ring);
  const axisFrame: Frame = { origin: axis.center, bearing: axis.bearing };
  const L = axis.length;
  const W = axis.width;
  // 正面朝忠孝東路（南），背面朝北平東路（北）
  const front = facePlane(faceFrame(ring, towards(ring, -90), L / 4).frame, axis.center);
  const back = facePlane(faceFrame(ring, towards(ring, 90), L / 4).frame, axis.center);
  // 主棟（不含兩面門廊）的進深，以及其中線相對輪廓中心的偏移
  const depth = front.setback + back.setback;
  const offset = (back.setback - front.setback) / 2;
  // 門廊的出挑即最小外接矩形的半寬扣去該面的退縮量
  const frontReach = W / 2 - front.setback;
  const backReach = W / 2 - back.setback;
  const porchWidth = L * EY_PORCH_WIDTH_RATIO;
  const name = "行政院中央大樓";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("executive-yuan", EY_NOTE, input));
  };
  /** 主棟量體：沿長邊置中，進深取兩面牆之間，不含門廊。 */
  const block = (length: number, width: number): Local[] =>
    rect(axisFrame, 0, offset, length, width);

  // 花崗石台基：外緣略向外突出，上緣收回一段，門廊也立於其上
  add({
    id: "base/plinth",
    name: `${name} 台基`,
    polygon: insetRing(ring, -EY_PLINTH_REACH),
    polygonTop: insetRing(ring, -EY_PLINTH_REACH + EY_PLINTH_BATTER),
    base: 0,
    height: EY_PLINTH_TOP,
  });
  // 一層牆身沿輪廓，含南北兩面的門廊腳
  add({
    id: "wall/ground",
    name: `${name} 一層牆身`,
    polygon: ring,
    base: 0,
    height: EY_GROUND_TOP,
  });
  add({
    id: "belt/ground",
    name: `${name} 一層腰線`,
    polygon: insetRing(ring, -EY_BALCONY_REACH / 3),
    base: EY_GROUND_TOP - 0.4,
    height: 0.4,
  });
  // 二三層牆身只覆蓋主棟：門廊之上為露臺，不再有樓層
  add({
    id: "wall/upper",
    name: `${name} 二三層牆身`,
    polygon: block(L - EY_WALL_INSET * 2, depth - EY_WALL_INSET * 2),
    base: EY_GROUND_TOP,
    height: EY_THIRD_TOP - EY_GROUND_TOP,
  });
  // 二三層各有一道向外突出的水平陽台帶，為立面的主要水平線條
  for (const [index, level] of [EY_GROUND_TOP, EY_SECOND_TOP].entries()) {
    add({
      id: `balcony/${index}`,
      name: `${name} 陽台帶`,
      polygon: block(L + EY_BALCONY_REACH * 2, depth + EY_BALCONY_REACH * 2),
      base: level,
      height: EY_BALCONY_THICKNESS,
    });
  }
  add({
    id: "cornice",
    name: `${name} 簷口`,
    polygon: block(L + EY_CORNICE_REACH * 2, depth + EY_CORNICE_REACH * 2),
    base: EY_THIRD_TOP,
    height: EY_CORNICE_TOP - EY_THIRD_TOP,
  });
  add({
    id: "parapet",
    name: `${name} 女兒牆`,
    polygon: block(L - EY_PARAPET_INSET * 2, depth - EY_PARAPET_INSET * 2),
    base: EY_CORNICE_TOP,
    height: EY_PARAPET_TOP - EY_CORNICE_TOP,
  });

  // 四個轉角的加厚壁體：轉角以圓弧收尾，量體上先以加厚的方形壁體表示
  for (const alongSide of [-1, 1]) {
    for (const lateralSide of [-1, 1]) {
      add({
        id: `corner/${alongSide < 0 ? "w" : "e"}${lateralSide < 0 ? "s" : "n"}`,
        name: `${name} 轉角壁體`,
        polygon: rect(
          axisFrame,
          (alongSide * (L - EY_CORNER_SIZE)) / 2,
          offset + (lateralSide * (depth - EY_CORNER_SIZE)) / 2,
          EY_CORNER_SIZE,
          EY_CORNER_SIZE,
        ),
        base: 0,
        height: EY_CORNICE_TOP,
      });
    }
  }

  // 正立面的柱列：立於二三層陽台帶的外緣，中央入口一段另有一對大柱，此處讓開
  const bays = Math.floor((L * 0.9) / EY_COLONNADE_BAY);
  const span = bays * EY_COLONNADE_BAY;
  for (let i = 0; i <= bays; i++) {
    const along = -span / 2 + i * EY_COLONNADE_BAY;
    if (Math.abs(along) < porchWidth / 2 + EY_COLONNADE_BAY / 2) continue;
    add({
      id: `colonnade/${i}`,
      name: `${name} 柱廊柱`,
      polygon: rect(front.frame, along, EY_COLONNADE_REACH, EY_COLONNADE_SIZE, EY_COLONNADE_SIZE),
      base: EY_GROUND_TOP,
      height: EY_THIRD_TOP - EY_GROUND_TOP,
    });
  }

  // 正面門廊：四支花崗石方柱立於門廊四角，柱頂承楣樑帶，其上為露臺欄杆
  for (const alongSide of [-1, 1]) {
    for (const [index, lateral] of [EY_PORCH_PIER / 2, frontReach].entries()) {
      add({
        id: `porch/front/pier/${alongSide < 0 ? "w" : "e"}${index}`,
        name: `${name} 門廊方柱`,
        polygon: rect(
          front.frame,
          (alongSide * porchWidth) / 2,
          lateral,
          EY_PORCH_PIER,
          EY_PORCH_PIER,
        ),
        base: 0,
        height: EY_GROUND_TOP,
      });
    }
  }
  add({
    id: "porch/front/fascia",
    name: `${name} 門廊楣樑帶`,
    polygon: rect(front.frame, 0, frontReach / 2, porchWidth + EY_PORCH_PIER, frontReach + 0.6),
    base: EY_PORCH_FASCIA_BASE,
    height: EY_PORCH_FASCIA_TOP - EY_PORCH_FASCIA_BASE,
  });
  add({
    id: "porch/front/terrace",
    name: `${name} 門廊露臺欄杆`,
    polygon: rect(front.frame, 0, frontReach / 2, porchWidth + EY_PORCH_PIER - 0.8, frontReach),
    base: EY_PORCH_FASCIA_TOP,
    height: EY_PORCH_RAIL_TOP - EY_PORCH_FASCIA_TOP,
  });
  // 中央入口貫通二三層的一對柱子，柱上為水平遮陽板
  for (const side of [-1, 1]) {
    add({
      id: `entrance/column/${side < 0 ? "w" : "e"}`,
      name: `${name} 中央入口柱`,
      polygon: rect(
        front.frame,
        (side * porchWidth) / 4,
        EY_ENTRY_COLUMN / 2,
        EY_ENTRY_COLUMN,
        EY_ENTRY_COLUMN,
      ),
      base: EY_PORCH_FASCIA_TOP,
      height: EY_COLUMN_TOP - EY_PORCH_FASCIA_TOP,
    });
  }
  add({
    id: "entrance/canopy",
    name: `${name} 中央入口遮陽板`,
    polygon: rect(front.frame, 0, EY_ENTRY_COLUMN, porchWidth, EY_ENTRY_COLUMN * 1.6),
    base: EY_COLUMN_TOP,
    height: EY_CANOPY_TOP - EY_COLUMN_TOP,
  });

  // 背面門廊（北面入口）：門廊之上為頂板與欄杆
  add({
    id: "porch/back/slab",
    name: `${name} 北面門廊頂板`,
    polygon: rect(back.frame, 0, backReach / 2, porchWidth + 1.2, backReach + 1.2),
    base: EY_GROUND_TOP,
    height: EY_BALCONY_THICKNESS,
  });
  add({
    id: "porch/back/rail",
    name: `${name} 北面門廊欄杆`,
    polygon: rect(back.frame, 0, backReach / 2, porchWidth + 0.4, backReach + 0.4),
    base: EY_GROUND_TOP + EY_BALCONY_THICKNESS,
    height: EY_PORCH_RAIL_TOP - EY_GROUND_TOP - EY_BALCONY_THICKNESS,
  });

  // 正面中段的四層：樓地板僅及一層的五分之一，退在三層屋頂之上
  const fourthWidth = L * EY_FOURTH_WIDTH_RATIO;
  const fourthDepth = front.setback * EY_FOURTH_DEPTH_RATIO;
  add({
    id: "fourth/wall",
    name: `${name} 四層牆身`,
    polygon: rect(front.frame, 0, -fourthDepth / 2, fourthWidth, fourthDepth),
    base: EY_THIRD_TOP,
    height: EY_FOURTH_TOP - EY_THIRD_TOP,
  });
  add({
    id: "fourth/cornice",
    name: `${name} 四層簷口`,
    polygon: rect(
      front.frame,
      0,
      -fourthDepth / 2,
      fourthWidth + EY_CORNICE_REACH * 2,
      fourthDepth + EY_CORNICE_REACH * 2,
    ),
    base: EY_FOURTH_TOP,
    height: EY_FOURTH_CORNICE_TOP - EY_FOURTH_TOP,
  });
  add({
    id: "fourth/parapet",
    name: `${name} 四層女兒牆`,
    polygon: rect(
      front.frame,
      0,
      -fourthDepth / 2,
      fourthWidth - EY_PARAPET_INSET * 2,
      fourthDepth - EY_PARAPET_INSET * 2,
    ),
    base: EY_FOURTH_CORNICE_TOP,
    height: EY_FOURTH_PARAPET_TOP - EY_FOURTH_CORNICE_TOP,
  });

  // 中央入口上方高起的量體：原設計於此處立塔未果，現況為收頭的方塊體
  const towerWidth = L * EY_TOWER_WIDTH_RATIO;
  const towerDepth = front.setback * EY_TOWER_DEPTH_RATIO;
  add({
    id: "tower/block",
    name: `${name} 中央入口量體`,
    polygon: rect(front.frame, 0, -towerDepth / 2 + EY_ENTRY_COLUMN / 2, towerWidth, towerDepth),
    base: EY_THIRD_TOP,
    height: EY_TOWER_TOP - EY_THIRD_TOP,
  });
  add({
    id: "tower/cap",
    name: `${name} 中央入口收頭`,
    polygon: rect(
      front.frame,
      0,
      -towerDepth / 2 + EY_ENTRY_COLUMN / 2,
      towerWidth + EY_PARAPET_INSET * 2,
      towerDepth + EY_PARAPET_INSET * 2,
    ),
    polygonTop: rect(
      front.frame,
      0,
      -towerDepth / 2 + EY_ENTRY_COLUMN / 2,
      towerWidth - EY_PARAPET_INSET * 2,
      towerDepth - EY_PARAPET_INSET * 2,
    ),
    base: EY_TOWER_TOP,
    height: EY_TOWER_CAP_TOP - EY_TOWER_TOP,
  });

  // 日字型平面中央的集會堂：挑高兩層半，屋頂高出兩側辦公棟
  add({
    id: "hall/roof",
    name: `${name} 集會堂屋頂`,
    polygon: block(L * EY_HALL_WIDTH_RATIO, depth * EY_HALL_DEPTH_RATIO),
    base: EY_THIRD_TOP,
    height: EY_HALL_ROOF_TOP - EY_THIRD_TOP,
  });
  add({
    id: "roof/plant",
    name: `${name} 屋頂機房`,
    polygon: rect(
      axisFrame,
      -L * EY_PLANT_ALONG_RATIO,
      offset + depth * EY_PLANT_LATERAL_RATIO,
      L * EY_PLANT_WIDTH_RATIO,
      depth * EY_PLANT_DEPTH_RATIO,
    ),
    base: EY_THIRD_TOP,
    height: EY_PLANT_TOP - EY_THIRD_TOP,
  });
  return parts;
}

export function claim(): Local[] {
  return outline(EXECUTIVE_YUAN);
}
