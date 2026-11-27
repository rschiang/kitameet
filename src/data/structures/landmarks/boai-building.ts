/** 博愛大樓：沿寶慶路與博愛路的 L 形五層廳舍，白色基座上以貫通巨柱分間，屋簷為連續摺板。 */
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

export const BOAI_BUILDING = "way/191741898";

/** 各段高程（公尺），地面為 0。 */
const BASE_TOP = 4.5; // 一層白色基座頂
const LEDGE_TOP = 5.0; // 二樓陽台帶頂
const WALL_TOP = 18.9; // 五層牆頂（二至五層各 3.6 公尺）
const FOLD_TOP = 20.3; // 摺板屋簷頂
const EAVE_TOP = 20.6; // 屋簷頂板頂
/** 巨柱開間的目標寬度與摺板屋簷的出挑（公尺）。 */
const BAY_TARGET = 6.5;
const EAVE_REACH = 2.0;

const BOAI_BUILDING_NOTE =
  "博愛大樓原為國防部博愛大樓，國防部於 2014 年 12 月遷往大直後交由法務部使用，" +
  "現為法務部廉政署（博愛路 166 號）與臺灣高等檢察署博一大樓（博愛路 164 號）（臺灣高等檢察署、法務部廉政署）。" +
  "平面取自 OSM 的 way/191741898，沿寶慶路與博愛路的 L 形：一層為白色基座，" +
  "二至五層以貫通的巨柱分間，屋簷為連續的摺板。" +
  "查無建造年代與高度文獻，一層取 4.5 公尺、二至五層各取 3.6 公尺推估，屋簷頂約 20.6 公尺。";

export function buildBoaiBuilding(): Feature[] {
  const ring = outline(BOAI_BUILDING);
  // 東面臨博愛路（104.5 m），北面臨寶慶路（80.1 m）
  const east = faceFrame(ring, towards(ring, 0), 20);
  const north = faceFrame(ring, towards(ring, 90), 20);
  const name = "博愛大樓";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("boai-building", BOAI_BUILDING_NOTE, input));
  };

  add({
    id: "base",
    name: `${name} 一層白色基座`,
    polygon: ring,
    base: 0,
    height: BASE_TOP,
  });
  add({
    id: "ledge",
    name: `${name} 二樓陽台帶`,
    polygon: insetRing(ring, -1.0),
    base: BASE_TOP,
    height: LEDGE_TOP - BASE_TOP,
  });
  add({
    id: "body",
    name: `${name} 二至五層`,
    polygon: ring,
    base: BASE_TOP,
    height: WALL_TOP - BASE_TOP,
  });

  // 沿街兩面：巨柱等分開間，每開間頂上一片自柱頂展開的摺板
  const faces: { face: { frame: Frame; length: number }; id: string }[] = [
    { face: east, id: "east" },
    { face: north, id: "north" },
  ];
  for (const { face, id } of faces) {
    const { frame: f, length: len } = face;
    const bays = Math.round(len / BAY_TARGET);
    const bay = len / bays;
    for (let i = 0; i <= bays; i++) {
      add({
        id: `${id}/pilaster/${i}`,
        name: `${name} 巨柱`,
        polygon: rect(f, -len / 2 + i * bay, 0.45, 0.8, 0.9),
        base: LEDGE_TOP,
        height: WALL_TOP - LEDGE_TOP,
      });
    }
    for (let j = 0; j < bays; j++) {
      const c = -len / 2 + (j + 0.5) * bay;
      add({
        id: `${id}/fold/${j}`,
        name: `${name} 摺板屋簷`,
        polygon: rect(f, c, EAVE_REACH / 2, 0.4, EAVE_REACH),
        polygonTop: rect(f, c, EAVE_REACH / 2, bay, EAVE_REACH),
        base: WALL_TOP,
        height: FOLD_TOP - WALL_TOP,
      });
    }
  }

  add({
    id: "eave",
    name: `${name} 屋簷頂板`,
    polygon: insetRing(ring, -EAVE_REACH),
    base: FOLD_TOP,
    height: EAVE_TOP - FOLD_TOP,
  });
  return parts;
}

export function claim(): Local[] {
  return outline(BOAI_BUILDING);
}
