/** 三井物產株式會社舊倉庫：二層磚木造倉庫，拱圈騎樓、洗石子腰線與寄棟式瓦頂。 */
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

export const MITSUI_WAREHOUSE = "way/589683660";

/** 台基、兩層磚牆、腰線與簷口的高程（公尺）。 */
const PLINTH_TOP = 0.45;
const GROUND_TOP = 4.3;
const BAND_TOP = 4.75;
const UPPER_TOP = 7.45;
const CORNICE_TOP = 8.0;
/** 屋面兩段與屋脊的高程（公尺）。 */
const ROOF_LOWER_TOP = 9.3;
const ROOF_UPPER_TOP = 10.7;
const RIDGE_TOP = 11.0;
/** 屋面各段的水平內縮（公尺）：自簷口外緣逐段收至中脊，負值即往輪廓外長。 */
const EAVE_REACH = 0.6;
const ROOF_LOWER_INSET = 2.4;
const ROOF_UPPER_INSET = 5.3;
/** 台基、腰線與簷口較牆面外伸的距離（公尺）。 */
const PLINTH_REACH = 0.35;
const BAND_REACH = 0.22;
const CORNICE_REACH = 0.5;
/** 正面拱圈騎樓：柱數、柱寬、端部留邊、起拱高與拱高（公尺）。 */
const ARCADE_PIERS = 4;
const PIER_WIDTH = 1.2;
const ARCADE_MARGIN = 0.3;
const ARCH_SPRING = 2.9;
const ARCH_RISE = 1.1;
const ARCH_STEPS = 2;
/** 柱墩與壁柱自牆面外凸的距離、壁柱寬度與側牆壁柱的最大間距（公尺）。 */
const PIER_REACH = 0.7;
const PIER_DEPTH = 1.0;
const PILASTER_REACH = 0.4;
const PILASTER_WIDTH = 1.1;
const PILASTER_SPACING = 5.5;
/** 山牆高程與厚度（公尺），以及山頂收邊與菱紋徽章的尺寸（公尺）。 */
const GABLE_BASE = 7.9;
const GABLE_TOP = 10.2;
const GABLE_THICKNESS = 0.7;
const GABLE_CAP = 0.3;
const CREST_BASE = 8.6;
const CREST_SIZE = 1.5;

const MITSUI_NOTE =
  "三井物產株式會社舊倉庫（今臺北記憶倉庫）為三井物產於 1914 年興建的二層磚木混合構造倉庫，" +
  "起造人為三井物產株式會社本店，原設計者不詳，2016 至 2018 年由符宏仁建築師主持解體重組，向東遷移 51 公尺後修復" +
  "（中文維基百科「三井物產株式會社舊倉庫」條目）：一層為四柱三間的連續拱圈騎樓，二層開三座垂直長條窗，" +
  "紅磚承重牆間夾水平洗石子飾帶，寄棟式屋頂覆日本瓦，正背立面中央各設山牆並嵌三井的三角菱紋徽章。" +
  "平面取自 OSM 輪廓 way/589683660，其朝忠孝西路的北面即山牆面，平面呈前段滿面寬、後段一側退縮的曲尺形。" +
  "條目未載總高，各部高度依條目所附正立面照片，以該輪廓短邊的面寬 19.0 公尺為比例尺換算：" +
  "照片中簷口約居面寬的 0.42、屋脊約居 0.58，換得簷口 8.0 公尺、屋脊 11.0 公尺，" +
  "與修復工程公布的建物高度 11 公尺相符。樓層高度、拱圈弧度、壁柱位置與山牆尺寸均為推估。";

/** 輪廓頂點換算為正面座標：`along` 沿正面，`depth` 自正面往建物內側量。 */
function localize(ring: Local[], frame: Frame): { along: number; depth: number }[] {
  const origin = point(frame, 0, 0);
  const alongUnit = point(frame, 1, 0);
  const lateralUnit = point(frame, 0, 1);
  const ax = alongUnit[0] - origin[0];
  const ay = alongUnit[1] - origin[1];
  const bx = lateralUnit[0] - origin[0];
  const by = lateralUnit[1] - origin[1];
  return ring.map(([x, y]) => {
    const dx = x - origin[0];
    const dy = y - origin[1];
    // faceFrame 的 lateral 朝輪廓外，進深取其反向
    return { along: dx * ax + dy * ay, depth: -(dx * bx + dy * by) };
  });
}

export function buildMitsuiWarehouse(): Feature[] {
  const ring = outline(MITSUI_WAREHOUSE);
  // 山牆面朝北臨忠孝西路，為全棟較短的一面；frame 的 lateral 朝街、along 沿該面
  const { frame, length: facade } = faceFrame(ring, towards(ring, 90), 15);
  // 輪廓為曲尺形：前段滿面寬、後段一側退縮，側牆壁柱依前後兩段的四面外牆放樣
  const corners = localize(ring, frame);
  const depth = Math.max(...corners.map((c) => c.depth));
  const frontCorners = corners.filter((c) => c.depth < depth / 2);
  const rearCorners = corners.filter((c) => c.depth >= depth / 2);
  const frontDepth = Math.max(...frontCorners.map((c) => c.depth));
  const rearCentre =
    (Math.min(...rearCorners.map((c) => c.along)) +
      Math.max(...rearCorners.map((c) => c.along))) /
    2;

  const name = "三井物產株式會社舊倉庫";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("mitsui-warehouse", MITSUI_NOTE, input));
  };

  // 台基、兩層磚牆、腰線與簷口：各層沿輪廓放樣，外伸者以負值的內縮往外長
  add({
    id: "base/plinth",
    name: `${name} 台基`,
    polygon: insetRing(ring, -PLINTH_REACH),
    base: 0,
    height: PLINTH_TOP,
  });
  add({
    id: "wall/ground",
    name: `${name} 一層磚牆`,
    polygon: ring,
    base: PLINTH_TOP,
    height: GROUND_TOP - PLINTH_TOP,
  });
  add({
    id: "band/waist",
    name: `${name} 洗石子腰線`,
    polygon: insetRing(ring, -BAND_REACH),
    base: GROUND_TOP,
    height: BAND_TOP - GROUND_TOP,
  });
  add({
    id: "wall/upper",
    name: `${name} 二層磚牆`,
    polygon: ring,
    base: BAND_TOP,
    height: UPPER_TOP - BAND_TOP,
  });
  add({
    id: "band/cornice",
    name: `${name} 簷口`,
    polygon: insetRing(ring, -CORNICE_REACH),
    base: UPPER_TOP,
    height: CORNICE_TOP - UPPER_TOP,
  });

  // 屋頂：自出挑的簷板起算，下緩上陡兩段瓦面收至中脊
  add({
    id: "roof/slope/0",
    name: `${name} 下段屋面`,
    polygon: insetRing(ring, -EAVE_REACH),
    polygonTop: insetRing(ring, ROOF_LOWER_INSET),
    base: CORNICE_TOP,
    height: ROOF_LOWER_TOP - CORNICE_TOP,
  });
  add({
    id: "roof/slope/1",
    name: `${name} 上段屋面`,
    polygon: insetRing(ring, ROOF_LOWER_INSET),
    polygonTop: insetRing(ring, ROOF_UPPER_INSET),
    base: ROOF_LOWER_TOP,
    height: ROOF_UPPER_TOP - ROOF_LOWER_TOP,
  });
  add({
    id: "roof/ridge",
    name: `${name} 屋脊`,
    polygon: insetRing(ring, ROOF_UPPER_INSET),
    base: ROOF_UPPER_TOP,
    height: RIDGE_TOP - ROOF_UPPER_TOP,
  });

  // 正面拱圈騎樓：四柱三間，柱墩與拱圈均凸出牆面，拱圈以兩階逼近弧線
  const span = facade - 2 * ARCADE_MARGIN;
  const clear = (span - ARCADE_PIERS * PIER_WIDTH) / (ARCADE_PIERS - 1);
  const pierAlong = (index: number): number =>
    -span / 2 + PIER_WIDTH / 2 + index * (PIER_WIDTH + clear);
  const arcadeLateral = PIER_REACH - PIER_DEPTH / 2;
  for (let i = 0; i < ARCADE_PIERS; i++) {
    add({
      id: `arcade/pier/${i}`,
      name: `${name} 騎樓柱墩`,
      polygon: rect(frame, pierAlong(i), arcadeLateral, PIER_WIDTH, PIER_DEPTH),
      base: PLINTH_TOP,
      height: ARCH_SPRING - PLINTH_TOP,
    });
  }
  // 弧高小於半跨的弓形拱：半徑由弦長與拱高推得
  const half = clear / 2;
  const radius = (half * half + ARCH_RISE * ARCH_RISE) / (2 * ARCH_RISE);
  for (let bay = 0; bay < ARCADE_PIERS - 1; bay++) {
    const centre = (pierAlong(bay) + pierAlong(bay + 1)) / 2;
    for (let k = 0; k < ARCH_STEPS; k++) {
      const lower = (ARCH_RISE * k) / ARCH_STEPS;
      const upper = (ARCH_RISE * (k + 1)) / ARCH_STEPS;
      // 該階頂面處的開口半寬：愈往上拱愈收，兩側砌體隨之加寬
      const halfOpen = Math.sqrt(
        Math.max(radius * radius - (radius - ARCH_RISE + upper) ** 2, 0),
      );
      const width = half - halfOpen;
      if (width < 0.05) continue;
      for (const side of [-1, 1]) {
        add({
          id: `arcade/arch/${bay}/${k}/${side < 0 ? "l" : "r"}`,
          name: `${name} 拱圈`,
          polygon: rect(
            frame,
            centre + side * (halfOpen + width / 2),
            arcadeLateral,
            width,
            PIER_DEPTH,
          ),
          base: ARCH_SPRING + lower,
          height: upper - lower,
        });
      }
    }
  }
  add({
    id: "arcade/lintel",
    name: `${name} 騎樓楣樑`,
    polygon: rect(frame, 0, arcadeLateral, facade, PIER_DEPTH),
    base: ARCH_SPRING + ARCH_RISE,
    height: GROUND_TOP + 0.1 - ARCH_SPRING - ARCH_RISE,
  });

  // 二層窗間壁柱：與騎樓柱墩對位，自腰線貫通至簷口
  for (let i = 0; i < ARCADE_PIERS; i++) {
    add({
      id: `facade/pilaster/${i}`,
      name: `${name} 窗間壁柱`,
      polygon: rect(frame, pierAlong(i), PILASTER_REACH / 2, PIER_WIDTH * 0.8, PILASTER_REACH),
      base: BAND_TOP,
      height: UPPER_TOP - BAND_TOP,
    });
  }

  // 側牆磚砌壁柱：前後兩段各有兩面側牆，依最大間距均分
  // l、r 指正面座標中 along 較小與較大的一側，退縮的那一面因此自成一段
  const walls: { block: string; side: string; along: number; sign: number }[] = [];
  for (const [block, group] of [
    ["front", frontCorners],
    ["rear", rearCorners],
  ] as const) {
    walls.push({
      block,
      side: "l",
      along: Math.min(...group.map((c) => c.along)),
      sign: -1,
    });
    walls.push({
      block,
      side: "r",
      along: Math.max(...group.map((c) => c.along)),
      sign: 1,
    });
  }
  for (const wall of walls) {
    const from = wall.block === "front" ? 0 : frontDepth;
    const run = (wall.block === "front" ? frontDepth : depth) - from;
    const count = Math.max(2, Math.round(run / PILASTER_SPACING));
    for (let i = 0; i < count; i++) {
      add({
        id: `side/pilaster/${wall.block}/${wall.side}/${i}`,
        name: `${name} 磚砌壁柱`,
        polygon: rect(
          frame,
          wall.along + (wall.sign * PILASTER_REACH) / 2,
          -(from + (run * (i + 0.5)) / count),
          PILASTER_REACH + 0.2,
          PILASTER_WIDTH,
        ),
        base: PLINTH_TOP,
        height: UPPER_TOP - PLINTH_TOP,
      });
    }
  }

  // 正面山牆：寬度取中央一間連同兩側柱墩，上收為梯形並以頂緣壓邊
  const gableWidth = clear + 2 * PIER_WIDTH;
  const gableLateral = GABLE_THICKNESS / 2 - 0.1;
  add({
    id: "gable/front",
    name: `${name} 正面山牆`,
    polygon: rect(frame, 0, gableLateral, gableWidth, GABLE_THICKNESS),
    polygonTop: rect(frame, 0, gableLateral, gableWidth * 0.34, GABLE_THICKNESS),
    base: GABLE_BASE,
    height: GABLE_TOP - GABLE_BASE,
  });
  add({
    id: "gable/cap",
    name: `${name} 山牆頂緣`,
    polygon: rect(frame, 0, gableLateral, gableWidth * 0.34 + 0.4, GABLE_THICKNESS + 0.2),
    base: GABLE_TOP,
    height: GABLE_CAP,
  });
  add({
    id: "gable/crest",
    name: `${name} 三井菱紋`,
    polygon: rect(frame, 0, gableLateral + GABLE_THICKNESS / 2, CREST_SIZE, 0.25),
    base: CREST_BASE,
    height: CREST_SIZE * 0.85,
  });

  // 背立面山牆：後段較窄，山牆隨之縮小並貼於背牆外側
  add({
    id: "gable/rear",
    name: `${name} 背面山牆`,
    polygon: rect(frame, rearCentre, -depth - gableLateral, gableWidth * 0.8, GABLE_THICKNESS),
    polygonTop: rect(
      frame,
      rearCentre,
      -depth - gableLateral,
      gableWidth * 0.3,
      GABLE_THICKNESS,
    ),
    base: GABLE_BASE,
    height: GABLE_TOP - GABLE_BASE,
  });
  return parts;
}

export function claim(): Local[] {
  return outline(MITSUI_WAREHOUSE);
}
