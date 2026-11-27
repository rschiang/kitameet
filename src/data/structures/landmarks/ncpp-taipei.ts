/** 國家攝影文化中心臺北館：L 形的三層面磚廳舍，西北切角上方立破風山牆與四角攢尖的塔屋。 */
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

export const NCPP_TAIPEI = "way/271367088";

/** 各段高程（公尺），地面為 0。 */
const PLINTH_TOP = 0.8; // 石材台基
const GROUND_TOP = 5.6; // 一層石材基座頂
const BELT_TOP = 6.2; // 一層簷帶頂
const WALL_TOP = 14.0; // 三層牆頂
const EAVE_TOP = 15.2; // 瓦簷頂
const GABLE_TOP = 17.8; // 轉角破風山牆尖
const TOWER_TOP = 20.0; // 塔屋牆頂
const TOWER_EAVE_TOP = 20.5; // 塔屋出簷頂
const ROOF_TOP = 23.5; // 攢尖屋頂
const FINIAL_TOP = 24.5; // 塔頂寶珠
/** 一層沿忠孝西路與懷寧街的開間數。 */
const NORTH_BAYS = 9;
const WEST_BAYS = 7;
/** 塔屋邊長、塔心距切角牆面的距離與塔屋出簷的邊長（公尺）。 */
const TOWER_SIDE = 6.0;
const TOWER_SETBACK = 5.0;
const TOWER_EAVE_SIDE = 8.6;

const NCPP_NOTE =
  "原大阪商船株式會社臺北支店，渡邊節建築事務所設計，1937 年落成，鋼筋混凝土造地上三層" +
  "（中文維基百科「原大阪商船株式會社臺北支店」條目）。" +
  "1968 年公路局拆除塔屋並加蓋四樓，2017 至 2020 年修復時拆除增建、依原貌重建塔屋，" +
  "2021 年起為國家攝影文化中心臺北館。" +
  "平面取自 OSM 的 way/271367088：沿忠孝西路與懷寧街的 L 形，西北角切角處立塔屋。" +
  "OSM 標 building:levels=18 與實物不符，未採用。" +
  "一層為石材基座、二三層為淺黃色溝面磚，轉角切面上方為破風山牆，塔屋覆四角攢尖瓦頂。" +
  "查無總高文獻，各段高程依修復後照片、以正面 33 公尺為比例尺換算，塔頂約 24.5 公尺，為推估值。";

export function buildNcppTaipei(): Feature[] {
  const ring = outline(NCPP_TAIPEI);
  // 北翼臨忠孝西路（33.0 m）、西翼臨懷寧街（27.1 m）
  const north = faceFrame(ring, towards(ring, 90), 20);
  const west = faceFrame(ring, towards(ring, 180), 20);
  // 西北切角僅 7.7 m，門檻須低於此；取 10 會選到西牆
  const { frame: corner } = faceFrame(ring, towards(ring, 135), 4);
  const name = "國家攝影文化中心臺北館";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("ncpp-taipei", NCPP_NOTE, input));
  };

  add({
    id: "base/plinth",
    name: `${name} 台基`,
    polygon: insetRing(ring, -0.3),
    base: 0,
    height: PLINTH_TOP,
  });
  add({
    id: "body/ground",
    name: `${name} 一層石材基座`,
    polygon: ring,
    base: PLINTH_TOP,
    height: GROUND_TOP - PLINTH_TOP,
  });
  add({
    id: "belt/ground",
    name: `${name} 一層簷帶`,
    polygon: insetRing(ring, -0.35),
    base: GROUND_TOP,
    height: BELT_TOP - GROUND_TOP,
  });
  add({
    id: "body/upper",
    name: `${name} 二三層面磚牆身`,
    polygon: ring,
    base: BELT_TOP,
    height: WALL_TOP - BELT_TOP,
  });
  add({
    id: "roof/eave",
    name: `${name} 瓦簷`,
    polygon: insetRing(ring, -0.9),
    polygonTop: insetRing(ring, 0.6),
    base: WALL_TOP,
    height: EAVE_TOP - WALL_TOP,
  });

  // 一層的石材壁柱：沿兩面街道等分開間
  const faces: { face: { frame: Frame; length: number }; bays: number; id: string }[] = [
    { face: north, bays: NORTH_BAYS, id: "north" },
    { face: west, bays: WEST_BAYS, id: "west" },
  ];
  for (const { face, bays, id } of faces) {
    const { frame, length } = face;
    for (let i = 0; i <= bays; i++) {
      add({
        id: `pier/${id}/${i}`,
        name: `${name} 一層壁柱`,
        polygon: rect(frame, -length / 2 + (i * length) / bays, 0.25, 1.2, 0.5),
        base: PLINTH_TOP,
        height: GROUND_TOP - PLINTH_TOP,
      });
    }
  }

  // 轉角切面：二樓陽台與簷上的破風山牆
  add({
    id: "corner/balcony",
    name: `${name} 轉角陽台`,
    polygon: rect(corner, 0, 0.6, 5.0, 1.2),
    base: GROUND_TOP,
    height: 0.9,
  });
  add({
    id: "corner/gable",
    name: `${name} 轉角破風`,
    polygon: rect(corner, 0, 0.4, 8.5, 0.8),
    polygonTop: rect(corner, 0, 0.4, 0.6, 0.8),
    base: WALL_TOP,
    height: GABLE_TOP - WALL_TOP,
  });

  // 塔屋：立於切角內側，覆四角攢尖瓦頂與寶珠
  add({
    id: "tower/shaft",
    name: `${name} 塔屋`,
    polygon: rect(corner, 0, -TOWER_SETBACK, TOWER_SIDE, TOWER_SIDE),
    base: WALL_TOP,
    height: TOWER_TOP - WALL_TOP,
  });
  add({
    id: "tower/eave",
    name: `${name} 塔屋出簷`,
    polygon: rect(corner, 0, -TOWER_SETBACK, TOWER_EAVE_SIDE, TOWER_EAVE_SIDE),
    base: TOWER_TOP,
    height: TOWER_EAVE_TOP - TOWER_TOP,
  });
  add({
    id: "tower/roof",
    name: `${name} 寶形造屋頂`,
    polygon: rect(corner, 0, -TOWER_SETBACK, TOWER_EAVE_SIDE, TOWER_EAVE_SIDE),
    polygonTop: rect(corner, 0, -TOWER_SETBACK, 0.8, 0.8),
    base: TOWER_EAVE_TOP,
    height: ROOF_TOP - TOWER_EAVE_TOP,
  });
  add({
    id: "tower/finial",
    name: `${name} 塔頂寶珠`,
    polygon: rect(corner, 0, -TOWER_SETBACK, 0.5, 0.5),
    polygonTop: rect(corner, 0, -TOWER_SETBACK, 0.15, 0.15),
    base: ROOF_TOP,
    height: FINIAL_TOP - ROOF_TOP,
  });
  return parts;
}

export function claim(): Local[] {
  return outline(NCPP_TAIPEI);
}
