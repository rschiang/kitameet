/** 西門紅樓：前棟八角樓的兩層紅磚量體與攢尖屋頂，後棟十字樓的兩坡屋頂與太子樓。 */
import type { Local } from "../../../geo/project.ts";
import type { Feature } from "../../schema.ts";
import {
  faceFrame,
  minAreaRect,
  outline,
  part,
  point,
  rect,
  towards,
  type Frame,
  type PartInput,
} from "./frame.ts";

export const RED_HOUSE = "way/222080307";

/**
 * 八角樓各部高程（公尺）：以條目所載「每正立面八公尺」為比例尺，
 * 依正立面照片量得簷口約為面寬的 1.35 倍、屋頂頂點約 2.05 倍、通風塔頂約 2.4 倍。
 */
const OCT_PLINTH_TOP = 0.9;
const OCT_LOWER_TOP = 5.4;
const OCT_BELT_HEIGHT = 0.5;
const OCT_UPPER_TOP = 10.1;
const OCT_CORNICE_TOP = 10.8;
const OCT_PARAPET_TOP = 11.6;
const OCT_ROOF_MID = 13.6;
const OCT_ROOF_APEX = 16.4;
const OCT_TURRET_TOP = 18.0;
const OCT_FINIAL_TOP = 19.2;
/** 八角樓屋面兩段的對邊距收分比例，與屋頂老虎窗的半徑比例。 */
const OCT_ROOF_MID_RATIO = 0.6;
const OCT_ROOF_TOP_RATIO = 0.115;
const OCT_DORMER_RATIO = 0.42;

/** 十字樓各部高程（公尺）：同一比例尺下的簷口、屋脊與太子樓。 */
const CROSS_PLINTH_TOP = 0.6;
const CROSS_EAVE_TOP = 7.2;
const CROSS_CORNICE_TOP = 7.9;
const CROSS_RIDGE_TOP = 10.8;
const CROSS_RIDGE_CAP_TOP = 11.2;
const CROSS_MONITOR_BASE = 10.0;
const CROSS_MONITOR_TOP = 11.9;
const CROSS_MONITOR_CAP_TOP = 12.7;
/** 十字樓屋脊的寬度與扶壁的間距（公尺）。 */
const CROSS_RIDGE_WIDTH = 1.3;
const CROSS_BUTTRESS_SPACING = 9;
/** 掃描線取樣數：十字樓兩翼的尺寸由此量得。 */
const SCAN_SAMPLES = 120;

const RED_HOUSE_NOTE =
  "西門紅樓為近藤十郎設計、1908 年落成的新起街市場（中文維基百科「西門紅樓」條目）：" +
  "前棟八角樓為兩層紅磚造，每面開拱窗，八角攢尖屋頂上開老虎窗、頂端設通風塔；" +
  "後棟十字樓為十字形平面的市場，磚砌扶壁撐起木屋架，兩坡屋頂的屋脊上設太子樓通氣。" +
  "平面取自 OSM 輪廓，八角樓的對邊距與十字樓兩翼的尺寸以垂直主軸的掃描線自輪廓量得。" +
  "條目載八角樓「每正立面八公尺」、占地四百一十二平方公尺，各部高度即以八公尺面寬為比例尺，" +
  "依正立面照片換算：簷口約一點三五倍（10.8 公尺）、屋頂頂點約二點○五倍（16.4 公尺）、" +
  "通風塔頂約二點四倍（19.2 公尺），十字樓按同一比例尺取簷口 7.2 公尺、屋脊 10.8 公尺，均為推估值。";

/** 輪廓頂點換算為主軸局部座標：第一項沿 `along`、第二項沿 `lateral`。 */
function toAxis(ring: Local[], frame: Frame): [number, number][] {
  const radians = (frame.bearing * Math.PI) / 180;
  const ux = Math.cos(radians);
  const uy = Math.sin(radians);
  return ring.map(([x, y]) => {
    const dx = x - frame.origin[0];
    const dy = y - frame.origin[1];
    return [dx * ux + dy * uy, -dx * uy + dy * ux];
  });
}

/** 垂直主軸的掃描線與輪廓的側向交會範圍；交點少於兩處時回傳 null。 */
function spanAt(local: [number, number][], along: number): [number, number] | null {
  const hits: number[] = [];
  for (let i = 0; i < local.length; i++) {
    const [a1, l1] = local[i];
    const [a2, l2] = local[(i + 1) % local.length];
    if (a1 === a2) continue;
    const t = (along - a1) / (a2 - a1);
    if (t < 0 || t >= 1) continue;
    hits.push(l1 + (l2 - l1) * t);
  }
  if (hits.length < 2) return null;
  return [Math.min(...hits), Math.max(...hits)];
}

/** 以主軸局部座標給出正八邊形（逆時針）：`across` 為對邊距，一面正對 `along`。 */
function octagon(frame: Frame, along: number, lateral: number, across: number): Local[] {
  const radius = across / 2 / Math.cos(Math.PI / 8);
  return Array.from({ length: 8 }, (_, i) => {
    const angle = ((i + 0.5) * Math.PI) / 4;
    return point(frame, along + radius * Math.cos(angle), lateral + radius * Math.sin(angle));
  });
}

export function buildRedHouse(): Feature[] {
  const ring = outline(RED_HOUSE);
  const axis = minAreaRect(ring);
  const frame: Frame = { origin: axis.center, bearing: axis.bearing };
  const local = toAxis(ring, frame);
  const aMax = Math.max(...local.map(([a]) => a));
  const aMin = Math.min(...local.map(([a]) => a));
  const name = "西門紅樓";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("red-house", RED_HOUSE_NOTE, input));
  };

  // 八角樓：正八邊形的深度與對邊距相等，自主軸正端往回收斂即得該段尺寸
  let across = axis.width;
  let octLateral = 0;
  for (let i = 0; i < 3; i++) {
    const front = local.filter(([a]) => a >= aMax - across);
    const low = Math.min(...front.map(([, l]) => l));
    const high = Math.max(...front.map(([, l]) => l));
    across = high - low;
    octLateral = (low + high) / 2;
  }
  const octAlong = aMax - across / 2;
  const join = aMax - across;

  // 十字樓：逐條掃描線量側向範圍，最寬的一段為橫向翼，其餘為縱向翼
  const step = (join - aMin) / SCAN_SAMPLES;
  const spans: { along: number; low: number; high: number }[] = [];
  for (let k = 0; k < SCAN_SAMPLES; k++) {
    const span = spanAt(local, aMin + (k + 0.5) * step);
    if (span !== null) spans.push({ along: aMin + (k + 0.5) * step, low: span[0], high: span[1] });
  }
  const widths = spans.map((s) => s.high - s.low);
  const threshold = (Math.min(...widths) + Math.max(...widths)) / 2;
  const wide = spans.filter((s) => s.high - s.low >= threshold);
  const narrow = spans.filter((s) => s.high - s.low < threshold);
  const median = (values: number[]): number =>
    [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)];

  const wideFirst = Math.min(...wide.map((s) => s.along));
  const wideLast = Math.max(...wide.map((s) => s.along));
  const crossLow = Math.min(...wide.map((s) => s.low));
  const crossHigh = Math.max(...wide.map((s) => s.high));
  // 取樣點位於各格中心，兩端各補半格還原橫向翼的進深
  const crossDepth = wideLast - wideFirst + step;
  const crossAlong = (wideFirst + wideLast) / 2;
  const crossSpan = crossHigh - crossLow;
  const crossLateral = (crossLow + crossHigh) / 2;
  const armWidth = median(narrow.map((s) => s.high - s.low));
  const armLateral = median(narrow.map((s) => (s.low + s.high) / 2));
  const armLength = join - aMin;
  const armAlong = (join + aMin) / 2;

  // 八角樓：台基、兩層牆身與其間的腰線
  add({
    id: "base/octagon",
    name: `${name} 八角樓台基`,
    polygon: octagon(frame, octAlong, octLateral, across + 1.6),
    base: 0,
    height: OCT_PLINTH_TOP,
  });
  add({
    id: "octagon/lower",
    name: `${name} 八角樓一層`,
    polygon: octagon(frame, octAlong, octLateral, across),
    base: OCT_PLINTH_TOP,
    height: OCT_LOWER_TOP - OCT_PLINTH_TOP,
  });
  add({
    id: "octagon/belt",
    name: `${name} 八角樓腰線`,
    polygon: octagon(frame, octAlong, octLateral, across + 0.6),
    base: OCT_LOWER_TOP,
    height: OCT_BELT_HEIGHT,
  });
  add({
    id: "octagon/upper",
    name: `${name} 八角樓二層`,
    polygon: octagon(frame, octAlong, octLateral, across),
    base: OCT_LOWER_TOP + OCT_BELT_HEIGHT,
    height: OCT_UPPER_TOP - OCT_LOWER_TOP - OCT_BELT_HEIGHT,
  });
  add({
    id: "octagon/cornice",
    name: `${name} 八角樓簷口`,
    polygon: octagon(frame, octAlong, octLateral, across + 1.2),
    base: OCT_UPPER_TOP,
    height: OCT_CORNICE_TOP - OCT_UPPER_TOP,
  });
  add({
    id: "octagon/parapet",
    name: `${name} 八角樓女兒牆`,
    polygon: octagon(frame, octAlong, octLateral, across + 0.4),
    base: OCT_CORNICE_TOP,
    height: OCT_PARAPET_TOP - OCT_CORNICE_TOP,
  });

  // 八角樓的八處角隅壁柱：貫通兩層，在轉角處加厚
  const cornerRadius = across / 2 / Math.cos(Math.PI / 8);
  for (let i = 0; i < 8; i++) {
    const angle = ((i + 0.5) * Math.PI) / 4;
    add({
      id: `octagon/pier/${i}`,
      name: `${name} 八角樓角隅壁柱`,
      polygon: rect(
        frame,
        octAlong + cornerRadius * Math.cos(angle),
        octLateral + cornerRadius * Math.sin(angle),
        1.3,
        1.3,
      ),
      base: OCT_PLINTH_TOP,
      height: OCT_CORNICE_TOP - OCT_PLINTH_TOP,
    });
  }

  // 攢尖屋頂：兩段斜面逐段收分，簷口之上起坡
  const roofMid = across * OCT_ROOF_MID_RATIO;
  const roofTop = across * OCT_ROOF_TOP_RATIO;
  add({
    id: "octagon/roof/0",
    name: `${name} 八角樓屋面`,
    polygon: octagon(frame, octAlong, octLateral, across - 0.4),
    polygonTop: octagon(frame, octAlong, octLateral, roofMid),
    base: OCT_CORNICE_TOP,
    height: OCT_ROOF_MID - OCT_CORNICE_TOP,
  });
  add({
    id: "octagon/roof/1",
    name: `${name} 八角樓屋面`,
    polygon: octagon(frame, octAlong, octLateral, roofMid),
    polygonTop: octagon(frame, octAlong, octLateral, roofTop),
    base: OCT_ROOF_MID,
    height: OCT_ROOF_APEX - OCT_ROOF_MID,
  });

  // 老虎窗：開在四處正對主軸與側向的屋面上
  const dormerRadius = across * OCT_DORMER_RATIO;
  const dormers: { id: string; along: number; lateral: number; length: number; width: number }[] = [
    { id: "front", along: dormerRadius, lateral: 0, length: 1.8, width: 2.8 },
    { id: "rear", along: -dormerRadius, lateral: 0, length: 1.8, width: 2.8 },
    { id: "left", along: 0, lateral: dormerRadius, length: 2.8, width: 1.8 },
    { id: "right", along: 0, lateral: -dormerRadius, length: 2.8, width: 1.8 },
  ];
  for (const dormer of dormers) {
    add({
      id: `octagon/dormer/${dormer.id}`,
      name: `${name} 八角樓老虎窗`,
      polygon: rect(
        frame,
        octAlong + dormer.along,
        octLateral + dormer.lateral,
        dormer.length,
        dormer.width,
      ),
      polygonTop: rect(
        frame,
        octAlong + dormer.along,
        octLateral + dormer.lateral,
        Math.min(dormer.length, 1.0),
        Math.min(dormer.width, 1.0),
      ),
      base: OCT_CORNICE_TOP + 0.4,
      height: 2.2,
    });
  }

  // 頂端通風塔與塔頂
  add({
    id: "octagon/turret",
    name: `${name} 八角樓通風塔`,
    polygon: octagon(frame, octAlong, octLateral, roofTop + 1.2),
    base: OCT_ROOF_APEX,
    height: OCT_TURRET_TOP - OCT_ROOF_APEX,
  });
  add({
    id: "octagon/turret/cap",
    name: `${name} 八角樓塔頂`,
    polygon: octagon(frame, octAlong, octLateral, roofTop + 2.0),
    polygonTop: octagon(frame, octAlong, octLateral, 0.8),
    base: OCT_TURRET_TOP,
    height: OCT_FINIAL_TOP - OCT_TURRET_TOP,
  });

  // 十字樓：兩翼各自的台基、牆身與簷口
  const wings: {
    id: string;
    label: string;
    along: number;
    lateral: number;
    length: number;
    width: number;
  }[] = [
    {
      id: "long",
      label: "縱向翼",
      along: armAlong,
      lateral: armLateral,
      length: armLength,
      width: armWidth,
    },
    {
      id: "transverse",
      label: "橫向翼",
      along: crossAlong,
      lateral: crossLateral,
      length: crossDepth,
      width: crossSpan,
    },
  ];
  for (const wing of wings) {
    add({
      id: `base/${wing.id}`,
      name: `${name} 十字樓台基`,
      polygon: rect(frame, wing.along, wing.lateral, wing.length + 1.2, wing.width + 1.2),
      base: 0,
      height: CROSS_PLINTH_TOP,
    });
    add({
      id: `cross/${wing.id}/wall`,
      name: `${name} 十字樓${wing.label}`,
      polygon: rect(frame, wing.along, wing.lateral, wing.length, wing.width),
      base: CROSS_PLINTH_TOP,
      height: CROSS_EAVE_TOP - CROSS_PLINTH_TOP,
    });
    add({
      id: `cross/${wing.id}/cornice`,
      name: `${name} 十字樓簷口`,
      polygon: rect(frame, wing.along, wing.lateral, wing.length + 1.0, wing.width + 1.0),
      base: CROSS_EAVE_TOP,
      height: CROSS_CORNICE_TOP - CROSS_EAVE_TOP,
    });
  }

  // 兩坡屋頂：縱向翼的屋脊沿主軸、橫向翼的屋脊沿側向，各自收成一道脊
  add({
    id: "cross/long/roof",
    name: `${name} 十字樓屋面`,
    polygon: rect(frame, armAlong, armLateral, armLength + 0.8, armWidth + 1.4),
    polygonTop: rect(frame, armAlong, armLateral, armLength + 0.8, CROSS_RIDGE_WIDTH),
    base: CROSS_CORNICE_TOP,
    height: CROSS_RIDGE_TOP - CROSS_CORNICE_TOP,
  });
  add({
    id: "cross/long/ridge",
    name: `${name} 十字樓屋脊`,
    polygon: rect(frame, armAlong, armLateral, armLength + 0.8, CROSS_RIDGE_WIDTH + 0.4),
    base: CROSS_RIDGE_TOP,
    height: CROSS_RIDGE_CAP_TOP - CROSS_RIDGE_TOP,
  });
  add({
    id: "cross/transverse/roof",
    name: `${name} 十字樓屋面`,
    polygon: rect(frame, crossAlong, crossLateral, crossDepth + 1.4, crossSpan + 0.8),
    polygonTop: rect(frame, crossAlong, crossLateral, CROSS_RIDGE_WIDTH, crossSpan + 0.8),
    base: CROSS_CORNICE_TOP,
    height: CROSS_RIDGE_TOP - CROSS_CORNICE_TOP,
  });
  add({
    id: "cross/transverse/ridge",
    name: `${name} 十字樓屋脊`,
    polygon: rect(frame, crossAlong, crossLateral, CROSS_RIDGE_WIDTH + 0.4, crossSpan + 0.8),
    base: CROSS_RIDGE_TOP,
    height: CROSS_RIDGE_CAP_TOP - CROSS_RIDGE_TOP,
  });

  // 太子樓：縱向翼屋脊上的通氣高窗與其小屋頂
  const monitorLength = armLength * 0.6;
  add({
    id: "cross/monitor",
    name: `${name} 十字樓太子樓`,
    polygon: rect(frame, armAlong, armLateral, monitorLength, CROSS_RIDGE_WIDTH + 1.4),
    base: CROSS_MONITOR_BASE,
    height: CROSS_MONITOR_TOP - CROSS_MONITOR_BASE,
  });
  add({
    id: "cross/monitor/roof",
    name: `${name} 十字樓太子樓屋面`,
    polygon: rect(frame, armAlong, armLateral, monitorLength + 0.6, CROSS_RIDGE_WIDTH + 2.2),
    polygonTop: rect(frame, armAlong, armLateral, monitorLength + 0.6, 0.7),
    base: CROSS_MONITOR_TOP,
    height: CROSS_MONITOR_CAP_TOP - CROSS_MONITOR_TOP,
  });

  // 磚砌扶壁：沿縱向翼兩側等距排列，撐起木屋架
  const bays = Math.max(2, Math.round(armLength / CROSS_BUTTRESS_SPACING));
  const spacing = armLength / bays;
  for (let i = 1; i < bays; i++) {
    const along = aMin + i * spacing;
    for (const side of [-1, 1]) {
      add({
        id: `cross/buttress/${i}/${side < 0 ? "s" : "n"}`,
        name: `${name} 十字樓扶壁`,
        polygon: rect(frame, along, armLateral + side * (armWidth / 2 + 0.35), 1.0, 0.9),
        base: CROSS_PLINTH_TOP,
        height: CROSS_EAVE_TOP - CROSS_PLINTH_TOP,
      });
    }
  }

  // 北側入口：取朝成都路一側的長牆為基準，門廊與雨庇定位於該段
  const { frame: north } = faceFrame(ring, towards(ring, 90), 20);
  add({
    id: "cross/porch",
    name: `${name} 十字樓北面門廊`,
    polygon: rect(north, 0, 1.4, 7.0, 2.8),
    base: 0,
    height: 4.2,
  });
  add({
    id: "cross/porch/canopy",
    name: `${name} 十字樓門廊雨庇`,
    polygon: rect(north, 0, 1.4, 8.2, 3.4),
    base: 4.2,
    height: 0.6,
  });
  return parts;
}

export function claim(): Local[] {
  return outline(RED_HOUSE);
}
