/** 臺北府城南門（麗正門）：石造城台、三開間開放式樓閣與歇山重簷屋頂。 */
import type { Local } from "../../../geo/project.ts";
import type { Feature } from "../../schema.ts";
import {
  minAreaRect,
  outline,
  part,
  rect,
  shift,
  type Frame,
  type PartInput,
} from "./frame.ts";

export const SOUTH_GATE = "way/245993047";

/** 城台與壓簷的高度（公尺）：城台高約為城台短向面寬的 0.36 倍。 */
const GATE_BASE_HEIGHT = 7.0;
const GATE_CAP_HEIGHT = 0.4;
/** 城台頂面四周的女兒牆。 */
const GATE_PARAPET_HEIGHT = 0.9;
const GATE_PARAPET_THICKNESS = 0.5;
/** 門洞淨寬與起拱高（公尺）：南門僅開單一拱門。 */
const GATE_OPENING = 4.2;
const GATE_SPRING = 3.4;
/** 圓拱以四段階梯逼近。 */
const GATE_ARCH_STEPS = 4;
/** 樓閣平面自城台內縮的距離（公尺）：長向為面寬方向，短向為門洞貫穿方向。 */
const PAVILION_INSET_ALONG = 7.4;
const PAVILION_INSET_LATERAL = 4.0;
/** 樓閣台基、下層柱廊與額枋的高度（公尺）。 */
const PAVILION_PLINTH_HEIGHT = 0.5;
const PAVILION_STOREY_HEIGHT = 3.4;
const PAVILION_ARCHITRAVE_HEIGHT = 0.55;
/** 柱身見方與廊柱退離樓閣外緣的距離（公尺）。 */
const COLUMN_SIZE = 0.65;
const COLUMN_MARGIN = 0.4;
/** 柱廊欄杆的高度與厚度（公尺）。 */
const RAIL_HEIGHT = 0.95;
const RAIL_THICKNESS = 0.3;
/** 牆身退在廊柱之後，留出四面的外廊（公尺，兩側合計）。 */
const GALLERY_DEPTH = 3.0;
/** 下簷與上簷的出挑與板厚（公尺）。 */
const LOWER_EAVE_REACH = 2.4;
const LOWER_EAVE_THICKNESS = 0.45;
const UPPER_EAVE_REACH = 2.3;
const UPPER_EAVE_THICKNESS = 0.45;
/** 上層樓身自下層內縮的距離、平座厚度與樓身高度（公尺）。 */
const UPPER_INSET = 2.8;
const UPPER_PLATFORM_HEIGHT = 0.35;
const UPPER_STOREY_HEIGHT = 2.4;
/** 正脊與鴟吻（公尺）。 */
const RIDGE_HEIGHT = 0.5;
const RIDGE_WIDTH = 1.0;
const OWL_HEIGHT = 1.4;

const GATE_NOTE =
  "臺北府城南門（麗正門）為 1884 年落成的臺北府城正門，規模冠於諸門（中文維基百科「臺北府城南門」條目）；" +
  "現貌並非原貌，而是 1966 年改建的北方宮殿式樣，僅石砌城台與門洞維持原狀，" +
  "城台之上為三開間的開放式樓閣，四面繞以廊柱，上下簷之間裝置琉璃花窗，屋頂為覆琉璃瓦的歇山重簷並帶翹起的翼角，正脊兩端置鴟吻。" +
  "平面取自 OSM 輪廓，minAreaRect 得 33.8 × 19.5 公尺。" +
  "文獻未載總高，各部高度依正立面照片以城台短向面寬 19.5 公尺為比例尺換算：" +
  "照片中城台高約為該面寬的 0.36 倍，得 7.0 公尺，樓閣兩層與重簷依同一比例尺量得，正脊頂約 18.9 公尺、鴟吻頂約 19.6 公尺，均為推估值。";

export function buildSouthGate(): Feature[] {
  const ring = outline(SOUTH_GATE);
  const axis = minAreaRect(ring);
  const frame: Frame = { origin: axis.center, bearing: axis.bearing };
  const L = axis.length;
  const W = axis.width;
  const name = "臺北府城南門";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("south-gate", GATE_NOTE, input));
  };
  // along 沿城台長向（城牆方向），lateral 指向北；門洞沿短向貫穿城台

  // 城台：門洞兩側的墩身、圓拱的階梯逼近，以及拱頂之上的實心段
  const half = GATE_OPENING / 2;
  const pier = L / 2 - half;
  for (const side of [-1, 1]) {
    add({
      id: `base/${side < 0 ? "west" : "east"}`,
      name: `${name} 城台`,
      polygon: rect(frame, side * (half + pier / 2), 0, pier, W),
      base: 0,
      height: GATE_BASE_HEIGHT,
    });
  }
  const radius = GATE_OPENING / 2;
  const step = radius / GATE_ARCH_STEPS;
  for (let k = 0; k < GATE_ARCH_STEPS; k++) {
    const top = GATE_SPRING + (k + 1) * step;
    // 該層頂面處的拱半寬；越往上拱越收，兩側砌體隨之加寬
    const halfOpen = Math.sqrt(Math.max(radius * radius - (top - GATE_SPRING) ** 2, 0));
    const width = half - halfOpen;
    if (width < 0.05) continue;
    for (const side of [-1, 1]) {
      add({
        id: `base/arch/${k}/${side < 0 ? "west" : "east"}`,
        name: `${name} 門洞拱圈`,
        polygon: rect(frame, side * (halfOpen + width / 2), 0, width, W),
        base: GATE_SPRING + k * step,
        height: step,
      });
    }
  }
  add({
    id: "base/crown",
    name: `${name} 門洞拱頂`,
    polygon: rect(frame, 0, 0, GATE_OPENING, W),
    base: GATE_SPRING + radius,
    height: GATE_BASE_HEIGHT - GATE_SPRING - radius,
  });
  add({
    id: "base/cap",
    name: `${name} 城台壓簷`,
    polygon: rect(frame, 0, 0, L + 0.9, W + 0.9),
    base: GATE_BASE_HEIGHT,
    height: GATE_CAP_HEIGHT,
  });

  // 城台頂面四周的女兒牆：長向兩道沿城牆方向，短向兩道封住兩端
  const capTop = GATE_BASE_HEIGHT + GATE_CAP_HEIGHT;
  const parapetOffset = GATE_PARAPET_THICKNESS / 2;
  for (const side of [-1, 1]) {
    add({
      id: `base/parapet/${side < 0 ? "south" : "north"}`,
      name: `${name} 城台女兒牆`,
      polygon: rect(frame, 0, side * (W / 2 - parapetOffset), L, GATE_PARAPET_THICKNESS),
      base: capTop,
      height: GATE_PARAPET_HEIGHT,
    });
    add({
      id: `base/parapet/${side < 0 ? "west" : "east"}`,
      name: `${name} 城台女兒牆`,
      polygon: rect(frame, side * (L / 2 - parapetOffset), 0, GATE_PARAPET_THICKNESS, W),
      base: capTop,
      height: GATE_PARAPET_HEIGHT,
    });
  }

  // 樓閣下層：台基、四面廊柱、退在柱後的牆身，柱頭以額枋相連
  const pavilionL = L - 2 * PAVILION_INSET_ALONG;
  const pavilionW = W - 2 * PAVILION_INSET_LATERAL;
  add({
    id: "pavilion/plinth",
    name: `${name} 樓閣台基`,
    polygon: rect(frame, 0, 0, pavilionL + 1.2, pavilionW + 1.2),
    base: capTop,
    height: PAVILION_PLINTH_HEIGHT,
  });
  const storeyBase = capTop + PAVILION_PLINTH_HEIGHT;
  const columnAlong = pavilionL / 2 - COLUMN_MARGIN;
  const columnLateral = pavilionW / 2 - COLUMN_MARGIN;
  // 三開間：長向四根柱位分出三間，短向兩間；中央柱位僅出現在四周，閣內不立柱
  for (const t of [-1, -1 / 3, 1 / 3, 1]) {
    for (const s of [-1, 0, 1]) {
      if (Math.abs(t) < 1 && Math.abs(s) < 1) continue;
      const column = `${t < 0 ? "w" : "e"}${Math.abs(t) < 1 ? "m" : "o"}${s < 0 ? "s" : s > 0 ? "n" : "m"}`;
      add({
        id: `pavilion/column/${column}`,
        name: `${name} 廊柱`,
        polygon: rect(frame, t * columnAlong, s * columnLateral, COLUMN_SIZE, COLUMN_SIZE),
        base: storeyBase,
        height: PAVILION_STOREY_HEIGHT,
      });
    }
  }
  for (const side of [-1, 1]) {
    add({
      id: `pavilion/rail/${side < 0 ? "south" : "north"}`,
      name: `${name} 廊欄杆`,
      polygon: rect(frame, 0, side * columnLateral, pavilionL - 0.8, RAIL_THICKNESS),
      base: storeyBase,
      height: RAIL_HEIGHT,
    });
    add({
      id: `pavilion/rail/${side < 0 ? "west" : "east"}`,
      name: `${name} 廊欄杆`,
      polygon: rect(frame, side * columnAlong, 0, RAIL_THICKNESS, pavilionW - 0.8),
      base: storeyBase,
      height: RAIL_HEIGHT,
    });
  }
  add({
    id: "pavilion/wall",
    name: `${name} 樓閣牆身`,
    polygon: rect(frame, 0, 0, pavilionL - GALLERY_DEPTH, pavilionW - GALLERY_DEPTH),
    base: storeyBase,
    height: PAVILION_STOREY_HEIGHT,
  });
  const lowerEaveBase = storeyBase + PAVILION_STOREY_HEIGHT;
  add({
    id: "pavilion/architrave",
    name: `${name} 額枋`,
    polygon: rect(frame, 0, 0, pavilionL + 0.4, pavilionW + 0.4),
    base: lowerEaveBase - PAVILION_ARCHITRAVE_HEIGHT,
    height: PAVILION_ARCHITRAVE_HEIGHT,
  });

  // 下簷：出挑的簷口、兩段愈近上層愈緩的屋面，以及四角上揚的翼角
  const lowerEaveL = pavilionL + 2 * LOWER_EAVE_REACH;
  const lowerEaveW = pavilionW + 2 * LOWER_EAVE_REACH;
  add({
    id: "roof/lower/eave",
    name: `${name} 下簷`,
    polygon: rect(frame, 0, 0, lowerEaveL, lowerEaveW),
    base: lowerEaveBase,
    height: LOWER_EAVE_THICKNESS,
  });
  const lowerSlopes: { rise: number; length: number; width: number }[] = [
    { rise: 0.7, length: lowerEaveL - 1.8, width: lowerEaveW - 1.8 },
    { rise: 0.5, length: lowerEaveL - 3.2, width: lowerEaveW - 3.2 },
  ];
  let lowerBase = lowerEaveBase + LOWER_EAVE_THICKNESS;
  let lowerFoot = { length: lowerEaveL, width: lowerEaveW };
  lowerSlopes.forEach((slope, i) => {
    add({
      id: `roof/lower/slope/${i}`,
      name: `${name} 下簷屋面`,
      polygon: rect(frame, 0, 0, lowerFoot.length, lowerFoot.width),
      polygonTop: rect(frame, 0, 0, slope.length, slope.width),
      base: lowerBase,
      height: slope.rise,
    });
    lowerBase += slope.rise;
    lowerFoot = { length: slope.length, width: slope.width };
  });
  for (const sa of [-1, 1]) {
    for (const sl of [-1, 1]) {
      const along = sa * (lowerEaveL / 2 - 0.9);
      const lateral = sl * (lowerEaveW / 2 - 0.9);
      add({
        id: `roof/lower/corner/${sa < 0 ? "w" : "e"}${sl < 0 ? "s" : "n"}`,
        name: `${name} 下簷翼角`,
        polygon: rect(frame, along, lateral, 1.8, 1.8),
        polygonTop: shift(rect(frame, along, lateral, 1.0, 1.0), frame, sa * 1.0, sl * 1.0),
        base: lowerEaveBase + LOWER_EAVE_THICKNESS - 0.2,
        height: 1.0,
      });
    }
  }

  // 上層樓身：平座、牆身，以及上下簷之間的琉璃花窗
  const upperL = pavilionL - 2 * UPPER_INSET;
  const upperW = pavilionW - 2 * UPPER_INSET;
  add({
    id: "upper/platform",
    name: `${name} 平座`,
    polygon: rect(frame, 0, 0, upperL + 1.2, upperW + 1.2),
    base: lowerBase,
    height: UPPER_PLATFORM_HEIGHT,
  });
  const upperBase = lowerBase + UPPER_PLATFORM_HEIGHT;
  add({
    id: "upper/wall",
    name: `${name} 上層樓身`,
    polygon: rect(frame, 0, 0, upperL, upperW),
    base: upperBase,
    height: UPPER_STOREY_HEIGHT,
  });
  for (const side of [-1, 1]) {
    add({
      id: `upper/lattice/${side < 0 ? "south" : "north"}`,
      name: `${name} 琉璃花窗`,
      polygon: rect(frame, 0, side * (upperW / 2 + 0.12), upperL * 0.78, 0.25),
      base: upperBase + 0.6,
      height: UPPER_STOREY_HEIGHT - 1.2,
    });
  }

  // 上簷：簷口、兩段屋面、正脊、鴟吻與四角翼角
  const upperEaveBase = upperBase + UPPER_STOREY_HEIGHT;
  const upperEaveL = upperL + 2 * UPPER_EAVE_REACH;
  const upperEaveW = upperW + 2 * UPPER_EAVE_REACH;
  add({
    id: "roof/upper/eave",
    name: `${name} 上簷`,
    polygon: rect(frame, 0, 0, upperEaveL, upperEaveW),
    base: upperEaveBase,
    height: UPPER_EAVE_THICKNESS,
  });
  // 歇山頂的屋面：下段較緩且四面同收，上段兩山面大幅內收，收出短於簷口的正脊
  const upperSlopes: { rise: number; length: number; width: number }[] = [
    { rise: 1.3, length: upperEaveL - 3.2, width: upperEaveW - 4.6 },
    { rise: 0.95, length: upperEaveL - 8.6, width: upperEaveW - 9.4 },
  ];
  let slopeBase = upperEaveBase + UPPER_EAVE_THICKNESS;
  let upperFoot = { length: upperEaveL, width: upperEaveW };
  upperSlopes.forEach((slope, i) => {
    const width = Math.max(slope.width, 0.9);
    add({
      id: `roof/upper/slope/${i}`,
      name: `${name} 上簷屋面`,
      polygon: rect(frame, 0, 0, upperFoot.length, upperFoot.width),
      polygonTop: rect(frame, 0, 0, slope.length, width),
      base: slopeBase,
      height: slope.rise,
    });
    slopeBase += slope.rise;
    upperFoot = { length: slope.length, width };
  });
  add({
    id: "roof/ridge",
    name: `${name} 正脊`,
    polygon: rect(frame, 0, 0, upperFoot.length, RIDGE_WIDTH),
    base: slopeBase,
    height: RIDGE_HEIGHT,
  });
  // 鴟吻：正脊兩端的吻獸，頂部略向內收並外探於脊外
  for (const side of [-1, 1]) {
    const along = side * (upperFoot.length / 2 + 0.35);
    add({
      id: `roof/owl/${side < 0 ? "west" : "east"}`,
      name: `${name} 鴟吻`,
      polygon: rect(frame, along, 0, 1.3, 1.1),
      polygonTop: shift(rect(frame, along, 0, 0.9, 0.7), frame, side * 0.5, 0),
      base: slopeBase - 0.2,
      height: OWL_HEIGHT,
    });
  }
  for (const sa of [-1, 1]) {
    for (const sl of [-1, 1]) {
      const along = sa * (upperEaveL / 2 - 0.9);
      const lateral = sl * (upperEaveW / 2 - 0.9);
      add({
        id: `roof/upper/corner/${sa < 0 ? "w" : "e"}${sl < 0 ? "s" : "n"}`,
        name: `${name} 上簷翼角`,
        polygon: rect(frame, along, lateral, 1.8, 1.8),
        polygonTop: shift(rect(frame, along, lateral, 1.0, 1.0), frame, sa * 1.1, sl * 1.1),
        base: upperEaveBase + UPPER_EAVE_THICKNESS - 0.25,
        height: 1.1,
      });
    }
  }
  return parts;
}

export function claim(): Local[] {
  return outline(SOUTH_GATE);
}
