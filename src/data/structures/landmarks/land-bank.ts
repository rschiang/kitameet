/** 臺灣土地銀行總行：館前路上的十層板樓，各層出挑水平遮陽板，兩端實牆收邊，屋頂設機房。 */
import type { Local } from "../../../geo/project.ts";
import type { Feature } from "../../schema.ts";
import {
  faceFrame,
  insetRing,
  minAreaRect,
  outline,
  part,
  rect,
  towards,
  type PartInput,
} from "./frame.ts";

export const LAND_BANK = "way/247678979";

/** 各段高程（公尺），地面為 0。 */
const BASE_TOP = 5.0; // 一層營業廳頂
const FLOOR = 3.4; // 標準層高
const STOREYS = 10; // OSM building:levels
const ROOF_TOP = BASE_TOP + (STOREYS - 1) * FLOOR; // 屋頂 35.6
const PARAPET_TOP = 36.6; // 女兒牆頂
const FIN_TOP = 37.6; // 兩端山牆頂
const PENTHOUSE_TOP = 39.1; // 屋頂機房頂

const LAND_BANK_NOTE =
  "臺灣土地銀行總行於 1965 年自勸業銀行舊廈遷至館前路的建業大樓（中文維基百科「勸業銀行舊廈」條目）。" +
  "平面取自 OSM 的 way/247678979（47.6 × 26.6 公尺，標 building:levels=10），正面朝東臨館前路：" +
  "一層營業廳上方為九層水平帶窗，各層樓板外緣出挑遮陽板，兩端以實牆收邊，屋頂設機房。" +
  "查無高度文獻，一層取 5 公尺、標準層取 3.4 公尺推估，屋頂約 35.6 公尺、機房頂約 39.1 公尺。";

export function buildLandBank(): Feature[] {
  const ring = outline(LAND_BANK);
  // 正面朝東臨館前路；along 朝南、lateral 朝東
  const { frame: front, length: facade } = faceFrame(ring, towards(ring, 0), 20);
  const W = minAreaRect(ring).width;
  const name = "臺灣土地銀行總行";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("land-bank", LAND_BANK_NOTE, input));
  };

  add({
    id: "base/ground",
    name: `${name} 一層營業廳`,
    polygon: ring,
    base: 0,
    height: BASE_TOP,
  });
  add({
    id: "canopy",
    name: `${name} 騎樓雨庇`,
    polygon: rect(front, 0, 1.2, facade, 2.4),
    base: 3.6,
    height: 0.5,
  });
  add({
    id: "body",
    name: `${name} 二至十層`,
    polygon: ring,
    base: BASE_TOP,
    height: ROOF_TOP - BASE_TOP,
  });
  // 各層樓板外緣的水平遮陽板
  for (let k = 1; k < STOREYS; k++) {
    add({
      id: `ledge/${k}`,
      name: `${name} 水平遮陽板`,
      polygon: rect(front, 0, 0.4, facade - 1.6, 0.8),
      base: BASE_TOP + (k - 1) * FLOOR,
      height: 0.25,
    });
  }
  for (const side of [-1, 1]) {
    add({
      id: `fin/${side < 0 ? "n" : "s"}`,
      name: `${name} 端部山牆`,
      polygon: rect(front, side * (facade / 2 - 0.4), 0.5, 0.8, 1.0),
      base: 0,
      height: FIN_TOP,
    });
  }
  add({
    id: "parapet",
    name: `${name} 女兒牆`,
    polygon: insetRing(ring, 0.3),
    base: ROOF_TOP,
    height: PARAPET_TOP - ROOF_TOP,
  });
  add({
    id: "roof/penthouse",
    name: `${name} 屋頂機房`,
    polygon: rect(front, 0, -W / 2, 12.0, 8.0),
    base: ROOF_TOP,
    height: PENTHOUSE_TOP - ROOF_TOP,
  });
  return parts;
}

export function claim(): Local[] {
  return outline(LAND_BANK);
}
