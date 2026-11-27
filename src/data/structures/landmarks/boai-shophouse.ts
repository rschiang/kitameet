/** 博愛路2號店屋（相機街三角屋）：迴轉道南側的梯形三層街屋，三面騎樓，上覆寄棟瓦頂與西側老虎窗，北面有「東」字泥塑。 */
import { clipPolygonToRing } from "../../../geo/clip.ts";
import { decompose } from "../../../geo/measure.ts";
import type { Local } from "../../../geo/project.ts";
import type { Feature } from "../../schema.ts";
import {
  faceFrame,
  insetRing,
  outline,
  part,
  point,
  polygonCentroid,
  rect,
  towards,
  type Frame,
  type PartInput,
} from "./frame.ts";

export const BOAI_SHOPHOUSE = "way/666930857";

/** 各段高程（公尺），地面為 0。 */
const PLINTH_TOP = 0.15; // 騎樓地坪
const GROUND_TOP = 3.4; // 一層頂（二樓樓板）
const THIRD_TOP = 10.2; // 三層牆頂
const EAVE_TOP = 10.5; // 出簷頂
const RIDGE_TOP = 12.5; // 屋脊：半跨約 5 公尺、四寸勾配

/** 平面尺寸（公尺）。 */
const ARCADE_DEPTH = 3.0; // 騎樓進深
const PIER = 0.7; // 騎樓柱邊長
const ARCADE_BAY = 3.6; // 側面騎樓柱距的目標值
const FRONT_PIERS = 4; // 北面「四柱」
const EAVE_REACH = 0.9; // 出簷
const RIDGE_ACROSS = 0.06; // 屋脊頂面的跨向縮放
const RIDGE_ALONG = 0.55; // 屋脊頂面的脊向縮放
const DORMER_HEIGHT = 1.3; // 老虎窗窗身高
const DORMER_HOOD = 0.5; // 老虎窗山牆高

const BOAI_SHOPHOUSE_NOTE =
  "博愛路2號店屋又稱相機街三角屋，位於博愛路與延平南路夾角、正對北門。" +
  "博愛路 2、4、6、8 號原為 1911 年建成的四連棟木造街屋，1927 至 1931 年京町改築時改建，" +
  "2020 年 5 月指定為直轄市定古蹟，2025 年修復完成並獲臺北老屋新生大獎評審團大獎（中央社、人間福報）：" +
  "正面保有「四柱三窗」的立面，外牆為十三溝面磚與清水紅磚，修復時將鐵皮屋頂換回日式瓦頂、" +
  "恢復西側屋頂的老虎窗，並重現北面簷下的「東」字泥塑。" +
  "平面取自 OSM 的 way/666930857：北面寬 8.2 公尺、南面寬 14.6 公尺、進深約 18 公尺的梯形，" +
  "北、西、東三面臨街，一樓三面皆為騎樓，騎樓深 3 公尺為推估。" +
  "查無高度文獻，三層樓高依修復後的正面照片、以北面寬 8.2 公尺為比例尺換算，屋脊約 12.5 公尺，為推估值。";

/** 寄棟屋頂的屋脊頂面：各頂點以形心為中心，沿 frame 的 along（跨向）與 lateral（脊向）分別縮放；頂點數不變，可與簷口輪廓放樣。 */
function ridgeOf(ring: Local[], frame: Frame, across: number, along: number): Local[] {
  const centre = polygonCentroid(ring);
  const axis: Frame = { origin: centre, bearing: frame.bearing };
  return ring.map((p) => {
    const d = decompose(centre, frame.bearing, p);
    return point(axis, d.along * across, d.lateral * along);
  });
}

export function buildBoaiShophouse(): Feature[] {
  const ring = outline(BOAI_SHOPHOUSE);
  // 北面正對北門、西面臨延平南路、東面臨博愛路。北面僅 8.2 公尺，門檻須取 4
  const { frame: north, length: Ln } = faceFrame(ring, towards(ring, 90), 4);
  const { frame: west, length: Lw } = faceFrame(ring, towards(ring, 180), 10);
  const { frame: east, length: Le } = faceFrame(ring, towards(ring, 0), 10);
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

  // 店面退在三面騎樓之後：依序以各臨街面向內 ARCADE_DEPTH 的半平面裁切輪廓
  const halfPlane = (f: Frame): Local[] => rect(f, 0, -ARCADE_DEPTH - 100, 400, 200);
  const core = [north, west, east].reduce<Local[][]>(
    (pieces, f) => pieces.flatMap((p) => clipPolygonToRing(p, halfPlane(f))),
    [ring],
  );
  if (core.length === 0) throw new Error("博愛路2號店屋的騎樓內牆裁切失敗");
  core.forEach((polygon, i) => {
    add({
      id: `body/ground-core/${i}`,
      name: `${name} 騎樓內店面`,
      polygon,
      base: PLINTH_TOP,
      height: GROUND_TOP - PLINTH_TOP,
    });
  });

  // 騎樓柱：北面「四柱」，側面依目標柱距等分；轉角柱只立一次（歸北面）
  const pier = (face: string, f: Frame, i: number, along: number): void => {
    add({
      id: `pier/${face}/${i}`,
      name: `${name} 騎樓柱`,
      polygon: rect(f, along, -PIER / 2, PIER, PIER),
      base: PLINTH_TOP,
      height: GROUND_TOP - PLINTH_TOP,
    });
  };
  for (let i = 0; i < FRONT_PIERS; i++) {
    pier("north", north, i, -Ln / 2 + PIER / 2 + (i * (Ln - PIER)) / (FRONT_PIERS - 1));
  }
  // 西面 along 朝北：i = bays 為西北角，已由北面立柱
  const westBays = Math.round((Lw - PIER) / ARCADE_BAY);
  for (let i = 0; i < westBays; i++) {
    pier("west", west, i, -Lw / 2 + PIER / 2 + (i * (Lw - PIER)) / westBays);
  }
  // 東面 along 朝南：i = 0 為東北角，已由北面立柱
  const eastBays = Math.round((Le - PIER) / ARCADE_BAY);
  for (let i = 1; i <= eastBays; i++) {
    pier("east", east, i, -Le / 2 + PIER / 2 + (i * (Le - PIER)) / eastBays);
  }

  add({
    id: "arcade/beam",
    name: `${name} 騎樓楣樑`,
    polygon: insetRing(ring, -0.1),
    base: GROUND_TOP - 0.5,
    height: 0.5,
  });
  add({
    id: "body/upper",
    name: `${name} 二三層`,
    polygon: ring,
    base: GROUND_TOP,
    height: THIRD_TOP - GROUND_TOP,
  });

  const eave = insetRing(ring, -EAVE_REACH);
  add({
    id: "roof/eave",
    name: `${name} 出簷`,
    polygon: eave,
    base: THIRD_TOP,
    height: EAVE_TOP - THIRD_TOP,
  });
  add({
    id: "roof/hip",
    name: `${name} 寄棟瓦頂`,
    polygon: eave,
    polygonTop: ridgeOf(eave, north, RIDGE_ACROSS, RIDGE_ALONG),
    base: EAVE_TOP,
    height: RIDGE_TOP - EAVE_TOP,
  });

  add({
    id: "dormer/west",
    name: `${name} 西側老虎窗`,
    polygon: rect(west, 0, -1.6, 1.8, 1.4),
    base: EAVE_TOP,
    height: DORMER_HEIGHT,
  });
  // 山牆頂面沿牆方向收窄，脊線垂直於西面
  add({
    id: "dormer/west-hood",
    name: `${name} 西側老虎窗山牆`,
    polygon: rect(west, 0, -1.6, 2.0, 1.6),
    polygonTop: rect(west, 0, -1.6, 0.3, 1.6),
    base: EAVE_TOP + DORMER_HEIGHT,
    height: DORMER_HOOD,
  });

  // 「東」字泥塑位於最靠博愛路一側的窗上方；北面 along 朝東
  add({
    id: "relief/east-mark",
    name: `${name} 北面「東」字泥塑`,
    polygon: rect(north, Ln * 0.17, 0.12, 0.8, 0.25),
    base: THIRD_TOP - 1.0,
    height: 0.6,
  });
  return parts;
}

export function claim(): Local[] {
  return outline(BOAI_SHOPHOUSE);
}
