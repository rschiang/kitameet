/** 臺北郵局：三層鋼筋混凝土廳舍，正面半圓拱門廊與貫通兩層的巨柱。 */
import type { Local } from "../../../geo/project.ts";
import type { Feature } from "../../schema.ts";
import {
  faceFrame,
  insetRing,
  outline,
  part,
  polygonCentroid,
  rect,
  type PartInput,
} from "./frame.ts";
import { NORTH_GATE } from "./north-gate.ts";

export const POST_OFFICE = "way/271754072";

/** 三層本體、增建四層與女兒牆的高程（公尺）。 */
const POST_GROUND = 5.4;
const POST_BODY_TOP = 15.2;
const POST_CORNICE_TOP = 16.3;
const POST_FOURTH_TOP = 19.9;
const POST_PARAPET_TOP = 20.6;
/** 正面柱廊的開間數、柱距與柱身尺寸（公尺）。 */
const POST_BAYS = 5;
const POST_BAY_SPACING = 4.6;
const POST_PIER = 1.4;
const POST_ARCH_STEPS = 2;
const POST_ARCH_SPRING = 3.0;

const POST_NOTE =
  "臺北郵局為栗山俊一設計、1930 年落成的三層鋼筋混凝土廳舍（中文維基百科「臺北郵局」條目）：" +
  "正面中央為半圓拱門廊，二三層以貫通兩層的巨柱分間，1969 年於三層屋頂增建第四層。" +
  "平面取自 OSM 輪廓，各部高度依正立面照片以開間尺寸為比例尺換算，為推估值。";

export function buildPostOffice(): Feature[] {
  const ring = outline(POST_OFFICE);
  // 正面朝北門：取朝向北門、長度足夠的外牆為立面基準
  const gate = polygonCentroid(outline(NORTH_GATE));
  const { frame, length: facade } = faceFrame(ring, gate, 20);
  const name = "臺北郵局";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("post-office", POST_NOTE, input));
  };

  add({
    id: "ground",
    name: `${name} 一層`,
    polygon: insetRing(ring, 1.0),
    base: 0,
    height: POST_GROUND,
  });
  add({
    id: "body",
    name: `${name} 二三層`,
    polygon: ring,
    base: POST_GROUND,
    height: POST_BODY_TOP - POST_GROUND,
  });
  add({
    id: "belt",
    name: `${name} 腰線`,
    polygon: insetRing(ring, -0.3),
    base: POST_GROUND,
    height: 0.6,
  });
  add({
    id: "cornice",
    name: `${name} 簷口`,
    polygon: insetRing(ring, -0.7),
    base: POST_BODY_TOP,
    height: POST_CORNICE_TOP - POST_BODY_TOP,
  });
  add({
    id: "fourth",
    name: `${name} 增建四層`,
    polygon: insetRing(ring, 1.0),
    base: POST_CORNICE_TOP,
    height: POST_FOURTH_TOP - POST_CORNICE_TOP,
  });
  add({
    id: "parapet",
    name: `${name} 女兒牆`,
    polygon: insetRing(ring, 0.85),
    base: POST_FOURTH_TOP,
    height: POST_PARAPET_TOP - POST_FOURTH_TOP,
  });

  // 正面柱廊：五開間的圓拱，柱身幾乎齊平於立面、柱後為退縮的一層外牆
  const porchWidth = POST_BAYS * POST_BAY_SPACING;
  const pierLateral = -1.0;
  for (let i = 0; i <= POST_BAYS; i++) {
    add({
      id: `porch/pier/${i}`,
      name: `${name} 門廊柱`,
      polygon: rect(frame, -porchWidth / 2 + i * POST_BAY_SPACING, pierLateral, POST_PIER, 2.2),
      base: 0,
      height: POST_GROUND - 0.2,
    });
  }
  const clear = POST_BAY_SPACING - POST_PIER;
  const archRadius = clear / 2;
  const archStep = archRadius / POST_ARCH_STEPS;
  for (let bay = 0; bay < POST_BAYS; bay++) {
    const centre = -porchWidth / 2 + (bay + 0.5) * POST_BAY_SPACING;
    for (let k = 0; k < POST_ARCH_STEPS; k++) {
      const top = POST_ARCH_SPRING + (k + 1) * archStep;
      const halfOpen = Math.sqrt(
        Math.max(archRadius * archRadius - (top - POST_ARCH_SPRING) ** 2, 0),
      );
      const width = archRadius - halfOpen;
      if (width < 0.05) continue;
      for (const side of [-1, 1]) {
        add({
          id: `porch/arch/${bay}/${k}/${side < 0 ? "l" : "r"}`,
          name: `${name} 門廊拱圈`,
          polygon: rect(frame, centre + side * (halfOpen + width / 2), pierLateral, width, 2.2),
          base: POST_ARCH_SPRING + k * archStep,
          height: archStep,
        });
      }
    }
  }
  add({
    id: "porch/lintel",
    name: `${name} 門廊楣樑`,
    polygon: rect(frame, 0, pierLateral, porchWidth + POST_PIER, 2.2),
    base: POST_ARCH_SPRING + archRadius,
    height: POST_GROUND - POST_ARCH_SPRING - archRadius + 0.2,
  });

  // 貫通二三層的巨柱：沿正面等距排列
  const pilasters = Math.max(3, Math.round(facade / POST_BAY_SPACING));
  const pilasterSpan = (pilasters - 1) * POST_BAY_SPACING;
  for (let i = 0; i < pilasters; i++) {
    add({
      id: `pilaster/${i}`,
      name: `${name} 巨柱`,
      polygon: rect(frame, -pilasterSpan / 2 + i * POST_BAY_SPACING, 0.1, 1.1, 1.0),
      base: POST_GROUND + 0.6,
      height: POST_BODY_TOP - POST_GROUND - 0.6,
    });
  }

  // 中央山頭與時鐘
  const pedimentWidth = porchWidth * 0.82;
  add({
    id: "pediment",
    name: `${name} 山頭`,
    polygon: rect(frame, 0, -0.3, pedimentWidth, 1.6),
    polygonTop: rect(frame, 0, -0.3, pedimentWidth - 3.0, 1.6),
    base: POST_CORNICE_TOP,
    height: 3.2,
  });
  add({
    id: "clock",
    name: `${name} 時鐘`,
    polygon: rect(frame, 0, 0.6, 2.0, 0.6),
    base: POST_CORNICE_TOP + 0.7,
    height: 1.8,
  });
  return parts;
}

export function claim(): Local[] {
  return outline(POST_OFFICE);
}
