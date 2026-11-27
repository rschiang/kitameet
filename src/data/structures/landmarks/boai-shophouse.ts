/** 博愛路2號店屋：三角窗上的三層街屋，一樓騎樓，上覆寄棟瓦頂，簷口有「東」字泥塑。 */
import type { Local } from "../../../geo/project.ts";
import type { Feature } from "../../schema.ts";
import {
  faceFrame,
  insetRing,
  outline,
  part,
  polygonCentroid,
  rect,
  towards,
  type Frame,
  type PartInput,
} from "./frame.ts";

export const BOAI_SHOPHOUSE = "way/615772162";

/** 各段高程（公尺），地面為 0：三層樓高約略相等，瓦頂高約簷高的 0.12。 */
const PLINTH_TOP = 0.15; // 騎樓地坪
const GROUND_TOP = 3.4; // 一層頂
const SECOND_TOP = 6.8; // 二層頂
const THIRD_TOP = 10.2; // 三層頂
const EAVE_TOP = 10.5; // 出簷頂
const RIDGE_TOP = 11.9; // 屋脊

const BOAI_SHOPHOUSE_NOTE =
  "博愛路2號店屋位於延平南路與博愛路交會的三角窗，1911 年建成，" +
  "1927 至 1931 年京町改築時改建為三層街屋，2020 年指定為直轄市定古蹟，" +
  "2023 至 2025 年以《京町改築紀念寫真帖》所載 1931 年外觀為準修復（人間福報、臺北老屋新生大獎）：" +
  "一樓為騎樓，正面溝面磚、側面清水紅磚，屋頂恢復日式瓦頂，簷口重現「東」字泥塑。" +
  "平面取自 OSM 的 way/615772162（該圖徵誤標為五月家青年旅舍，旅舍實址為忠孝西路一段 122 號 6 樓）。" +
  "查無高度文獻，三層樓高依修復後照片的層高比例推估，屋脊約 11.9 公尺。";

/** 各頂點以形心為中心等比縮放；頂點數不變，三角形平面的出簷與寄棟屋頂皆以此放樣，避開輪廓上的細碎短邊。 */
function scaleAbout(ring: Local[], factor: number): Local[] {
  const [cx, cy] = polygonCentroid(ring);
  return ring.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor] as Local);
}

export function buildBoaiShophouse(): Feature[] {
  const ring = outline(BOAI_SHOPHOUSE);
  // 三角形的三面：北面正對北門、西面臨延平南路、斜面臨博愛路。
  // 各面僅 5 至 8 公尺，門檻須取 4，取 10 會找不到正面
  const north = faceFrame(ring, towards(ring, 90), 4);
  const west = faceFrame(ring, towards(ring, 180), 4);
  const diagonal = faceFrame(ring, towards(ring, 0), 4);
  const name = "博愛路2號店屋";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("boai-shophouse", BOAI_SHOPHOUSE_NOTE, input));
  };

  add({
    id: "base/plinth",
    name: `${name} 騎樓地坪`,
    polygon: ring,
    base: 0,
    height: PLINTH_TOP,
  });
  // 店面退在騎樓之後：輪廓向內縮約 1.7 公尺
  add({
    id: "body/ground-core",
    name: `${name} 騎樓內店面`,
    polygon: scaleAbout(ring, 0.55),
    base: PLINTH_TOP,
    height: GROUND_TOP - PLINTH_TOP,
  });
  // 騎樓柱：三角形三面沿街立柱，轉角柱只立一次
  const piers: { face: { frame: Frame; length: number }; id: string; at: (L: number) => number[] }[] =
    [
      { face: north, id: "north", at: (L) => [-L / 2 + 0.35, 0, L / 2 - 0.35] },
      { face: west, id: "west", at: (L) => [-L / 2 + 0.35, 0] },
      { face: diagonal, id: "diagonal", at: () => [0] },
    ];
  for (const { face, id, at } of piers) {
    at(face.length).forEach((along, i) => {
      add({
        id: `pier/${id}/${i}`,
        name: `${name} 騎樓柱`,
        polygon: rect(face.frame, along, -0.35, 0.7, 0.7),
        base: PLINTH_TOP,
        height: GROUND_TOP - PLINTH_TOP,
      });
    });
  }

  add({
    id: "body/second",
    name: `${name} 二層`,
    polygon: ring,
    base: GROUND_TOP,
    height: SECOND_TOP - GROUND_TOP,
  });
  add({
    id: "body/third",
    name: `${name} 三層`,
    polygon: ring,
    base: SECOND_TOP,
    height: THIRD_TOP - SECOND_TOP,
  });
  add({
    id: "belt/second",
    name: `${name} 一二層間腰線`,
    polygon: scaleAbout(ring, 1.04),
    base: GROUND_TOP - 0.15,
    height: 0.3,
  });
  add({
    id: "belt/third",
    name: `${name} 二三層間腰線`,
    polygon: scaleAbout(ring, 1.04),
    base: SECOND_TOP - 0.15,
    height: 0.3,
  });

  // 寄棟瓦頂：出簷後收向形心
  add({
    id: "roof/eave",
    name: `${name} 出簷`,
    polygon: scaleAbout(ring, 1.12),
    base: THIRD_TOP,
    height: EAVE_TOP - THIRD_TOP,
  });
  add({
    id: "roof/hip",
    name: `${name} 寄棟瓦頂`,
    polygon: scaleAbout(ring, 1.12),
    polygonTop: scaleAbout(ring, 0.12),
    base: EAVE_TOP,
    height: RIDGE_TOP - EAVE_TOP,
  });
  add({
    id: "relief/east-mark",
    name: `${name} 簷口「東」字泥塑`,
    polygon: rect(north.frame, 0, 0.15, 1.2, 0.3),
    base: THIRD_TOP - 1.0,
    height: 0.8,
  });
  return parts;
}

/**
 * 公告圖的三角形房屋面 dorts/building/327 即同一棟，但畫在 OSM 輪廓西側約 2 公尺，
 * 形心恰落在 OSM 輪廓外；認領範圍向外放寬 2 公尺才能讓位，且不及鄰棟的形心。
 */
export function claim(): Local[] {
  return insetRing(outline(BOAI_SHOPHOUSE), -2);
}
