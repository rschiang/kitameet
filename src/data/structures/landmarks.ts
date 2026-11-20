/**
 * 四座地標建物的細部量體：臺北車站站體、臺北郵局、新光摩天大樓與臺北府城北門。
 *
 * OSM 與禁限建公告圖都只有 2D 輪廓，拉高後是四塊方盒子，看不出哪一棟是哪一棟。
 * 本模組依現場照片的立面比例，把每座地標拆成台基、柱列、腰線、簷口、屋頂斜面
 * 與塔冠等量體；平面一律由既有輪廓（公告圖優先、其次 OSM）推算，不新增座標常數，
 * 高度則以文獻值為準、其餘依立面照片的比例換算。
 *
 * 每座地標各自宣告一塊認領範圍（{@link landmarkClaims}），形心落在範圍內的建物量體
 * 由 `buildBaseline()` 移除，避免地形圖的房屋面與細部量體重疊。
 */
import { insetRing } from "../../geo/offset.ts";
import { advance, minAreaRect, pointInPolygon, polygonArea, polygonCentroid } from "../../geo/measure.ts";
import type { Local } from "../../geo/project.ts";
import surfaceJson from "../osm/surface.json";
import type { OsmDataset } from "../osm-types.ts";
import { dortsBuildingPolygons } from "../dorts.ts";
import type { Feature } from "../schema.ts";

const surface = surfaceJson as unknown as OsmDataset;

const NORTH_GATE = "way/238316480";
const POST_OFFICE = "way/271754072";
const SHIN_KONG = "way/204711206";
const TAIPEI_STATION = "way/23641610";

/** 由本模組建模、因而排除原輪廓量體的 OSM 建物。 */
export const LANDMARK_MODEL_IDS = [NORTH_GATE, POST_OFFICE, SHIN_KONG, TAIPEI_STATION] as const;

/** OSM 輪廓；缺漏時立即失敗，避免靜默少掉一座地標。 */
function outline(id: string): Local[] {
  const feature = surface.features.find((f) => f.id === id);
  if (!feature?.polygon) throw new Error(`找不到 OSM 輪廓 ${id}`);
  return feature.polygon;
}

/** 落在輪廓內、面積最大的公告圖房屋面；沒有命中時回傳 null。 */
function dortsFaceIn(ring: Local[]): Local[] | null {
  let best: { polygon: Local[]; area: number } | null = null;
  for (const polygon of dortsBuildingPolygons()) {
    if (!pointInPolygon(polygonCentroid(polygon), ring)) continue;
    const area = Math.abs(polygonArea(polygon));
    if (best === null || area > best.area) best = { polygon, area };
  }
  return best?.polygon ?? null;
}

/** 以某條邊為基準的局部座標系：`along` 沿邊、`lateral` 指向量體外側。 */
interface Frame {
  origin: Local;
  /** 自正東起算的度數；`lateral` 為此方位的左側。 */
  bearing: number;
}

function point(frame: Frame, along: number, lateral: number): Local {
  return advance(advance(frame.origin, frame.bearing, along), frame.bearing + 90, lateral);
}

/** 以局部座標給出矩形環（逆時針）。 */
function rect(frame: Frame, along: number, lateral: number, length: number, width: number): Local[] {
  const a = length / 2;
  const b = width / 2;
  return [
    point(frame, along - a, lateral - b),
    point(frame, along + a, lateral - b),
    point(frame, along + a, lateral + b),
    point(frame, along - a, lateral + b),
  ];
}

/** 把環整體平移後回傳，用於外傾的翹角與燕尾。 */
function shift(ring: Local[], frame: Frame, along: number, lateral: number): Local[] {
  const origin = point(frame, 0, 0);
  const moved = point(frame, along, lateral);
  const dx = moved[0] - origin[0];
  const dy = moved[1] - origin[1];
  return ring.map(([x, y]) => [x + dx, y + dy] as Local);
}

/** 把方向相近的連續邊併為一段：輪廓常把同一面牆切成數段短邊。 */
function mergedEdges(ring: Local[], toleranceDeg = 8): { a: Local; b: Local }[] {
  const n = ring.length;
  const direction = (a: Local, b: Local): number => Math.atan2(b[1] - a[1], b[0] - a[0]);
  const runs: { a: Local; b: Local; heading: number }[] = [];
  const tolerance = (toleranceDeg * Math.PI) / 180;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) continue;
    const heading = direction(a, b);
    const last = runs[runs.length - 1];
    const delta =
      last === undefined ? Infinity : Math.abs(Math.atan2(Math.sin(heading - last.heading), Math.cos(heading - last.heading)));
    if (last !== undefined && delta <= tolerance) last.b = b;
    else runs.push({ a, b, heading });
  }
  // 首尾同向時接成一段，避免正面被輪廓的起點切斷
  if (runs.length > 1) {
    const first = runs[0];
    const last = runs[runs.length - 1];
    const delta = Math.abs(
      Math.atan2(Math.sin(first.heading - last.heading), Math.cos(first.heading - last.heading)),
    );
    if (delta <= tolerance) {
      first.a = last.a;
      runs.pop();
    }
  }
  return runs.map(({ a, b }) => ({ a, b }));
}

/**
 * 由輪廓中朝向某處的外牆建立正面座標系：`lateral` 朝向輪廓外。
 * 取法線最正對目標者（同等正對時取較長的一段），不以長度加權，
 * 否則側面的長牆會蓋過較短的正面。
 */
function faceFrame(
  ring: Local[],
  toward: Local,
  minLength: number,
): { frame: Frame; length: number } {
  // 逆時針環的外側在各邊右手側，順時針則相反
  const outwardSign = polygonArea(ring) >= 0 ? 1 : -1;
  let best: { frame: Frame; length: number; facing: number } | undefined;
  for (const { a, b } of mergedEdges(ring)) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length < minLength) continue;
    const mid: Local = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const nx = (dy / length) * outwardSign;
    const ny = (-dx / length) * outwardSign;
    const tx = toward[0] - mid[0];
    const ty = toward[1] - mid[1];
    const distance = Math.hypot(tx, ty) || 1;
    const facing = (nx * tx + ny * ty) / distance;
    if (facing <= 0) continue;
    // lateral 需朝外：取外法線為左側的行進方向
    const bearing = (Math.atan2(-dy, -dx) * 180) / Math.PI;
    const frame: Frame = { origin: mid, bearing };
    const better =
      best === undefined ||
      facing > best.facing + 0.05 ||
      (Math.abs(facing - best.facing) <= 0.05 && length > best.length);
    if (better) best = { frame, length, facing };
  }
  if (best === undefined) throw new Error("找不到朝向目標的正面");
  return { frame: best.frame, length: best.length };
}

interface PartInput {
  id: string;
  name: string;
  polygon: Local[];
  polygonTop?: Local[];
  base: number;
  height: number;
}

function part(landmark: string, note: string, input: PartInput): Feature {
  const feature: Feature = {
    id: `landmark/${landmark}/${input.id}`,
    kind: "landmark",
    name: input.name,
    level: "G",
    layer: "landmark",
    geometry: input.polygonTop
      ? { polygon: input.polygon, polygonTop: input.polygonTop }
      : { polygon: input.polygon },
    base: input.base,
    height: input.height,
    confidence: "estimated",
    sourceNote: note,
    status: "existing",
  };
  return feature;
}

// ── 臺北府城北門（承恩門） ────────────────────────────────
/** 台座、城樓與屋頂的高度（公尺），依正立面照片以台座面寬為比例尺換算。 */
const GATE_BASE_HEIGHT = 5.6;
const GATE_CAP_HEIGHT = 0.35;
const GATE_CHAMBER_HEIGHT = 4.65;
const GATE_EAVE_THICKNESS = 0.45;
/** 門洞淨寬與起拱高（公尺）。 */
const GATE_OPENING = 3.6;
const GATE_SPRING = 3.2;
/** 圓拱以四段階梯逼近。 */
const GATE_ARCH_STEPS = 4;
/** 城樓外壁自台座內縮、屋簷自城樓外伸的距離（公尺）。 */
const GATE_CHAMBER_INSET = 0.8;
const GATE_EAVE_REACH = 1.9;

const GATE_NOTE =
  "臺北府城北門為單簷重脊歇山頂的封閉碉堡式城門（中文維基百科「臺北府城北門」條目）：" +
  "安山岩台座內開圓拱門洞、紅磚城樓外壁環包、屋頂出簷並帶燕尾翹角。" +
  "平面取自禁限建公告圖所附 1/1000 地形圖的台座輪廓，各部高度依正立面照片以台座面寬為比例尺換算，為推估值。";

function buildNorthGate(): Feature[] {
  const base = dortsFaceIn(outline(NORTH_GATE)) ?? outline(NORTH_GATE);
  const axis = minAreaRect(base);
  const frame: Frame = { origin: axis.center, bearing: axis.bearing };
  const L = axis.length;
  const W = axis.width;
  const name = "臺北府城北門";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("north-gate", GATE_NOTE, input));
  };

  // 台座：門洞兩側的墩身、圓拱的階梯逼近，以及拱頂之上的實心段
  const half = GATE_OPENING / 2;
  const pier = L / 2 - half;
  for (const side of [-1, 1]) {
    add({
      id: `base/${side < 0 ? "west" : "east"}`,
      name: `${name} 台座`,
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
    name: `${name} 台座壓簷`,
    polygon: rect(frame, 0, 0, L + 0.8, W + 0.8),
    base: GATE_BASE_HEIGHT,
    height: GATE_CAP_HEIGHT,
  });

  // 城樓紅磚外壁與北面門額
  const chamberBase = GATE_BASE_HEIGHT + GATE_CAP_HEIGHT;
  const chamberL = L - 2 * GATE_CHAMBER_INSET;
  const chamberW = W - 2 * GATE_CHAMBER_INSET;
  add({
    id: "chamber",
    name: `${name} 城樓`,
    polygon: rect(frame, 0, 0, chamberL, chamberW),
    base: chamberBase,
    height: GATE_CHAMBER_HEIGHT,
  });
  add({
    id: "plaque",
    name: `${name} 門額`,
    polygon: rect(frame, 0, chamberW / 2 + 0.12, 2.4, 0.3),
    base: chamberBase + 0.65,
    height: 0.9,
  });

  // 屋頂：出挑的簷口、三段內收的斜面、正脊與燕尾翹角
  const eaveBase = chamberBase + GATE_CHAMBER_HEIGHT;
  const eaveL = chamberL + 2 * GATE_EAVE_REACH;
  const eaveW = chamberW + 2 * GATE_EAVE_REACH;
  add({
    id: "roof/eave",
    name: `${name} 屋簷`,
    polygon: rect(frame, 0, 0, eaveL, eaveW),
    base: eaveBase,
    height: GATE_EAVE_THICKNESS,
  });
  // 下緩上陡的三段斜面：閩南式屋面為凹曲，愈近正脊愈陡
  const slopes: { rise: number; length: number; width: number }[] = [
    { rise: 1.3, length: eaveL - 2.2, width: eaveW - 4.8 },
    { rise: 1.2, length: eaveL - 4.0, width: eaveW - 9.6 },
    { rise: 0.9, length: eaveL - 5.4, width: eaveW - 12.2 },
  ];
  let slopeBase = eaveBase + GATE_EAVE_THICKNESS;
  let lower = { length: eaveL, width: eaveW };
  slopes.forEach((slope, i) => {
    add({
      id: `roof/slope/${i}`,
      name: `${name} 屋面`,
      polygon: rect(frame, 0, 0, lower.length, lower.width),
      polygonTop: rect(frame, 0, 0, slope.length, Math.max(slope.width, 0.8)),
      base: slopeBase,
      height: slope.rise,
    });
    slopeBase += slope.rise;
    lower = { length: slope.length, width: Math.max(slope.width, 0.8) };
  });
  add({
    id: "roof/ridge",
    name: `${name} 正脊`,
    polygon: rect(frame, 0, 0, lower.length, 0.9),
    base: slopeBase,
    height: 0.4,
  });
  // 燕尾：正脊兩端向外上方翹起
  for (const side of [-1, 1]) {
    const along = side * (lower.length / 2 + 0.3);
    add({
      id: `roof/tail/${side < 0 ? "west" : "east"}`,
      name: `${name} 燕尾`,
      polygon: rect(frame, along, 0, 1.4, 0.8),
      polygonTop: shift(rect(frame, along, 0, 1.0, 0.5), frame, side * 1.5, 0),
      base: slopeBase - 0.1,
      height: 1.1,
    });
  }
  // 翼角：四個簷角沿對角微微上揚
  for (const sa of [-1, 1]) {
    for (const sl of [-1, 1]) {
      const along = sa * (eaveL / 2 - 0.8);
      const lateral = sl * (eaveW / 2 - 0.8);
      add({
        id: `roof/corner/${sa < 0 ? "w" : "e"}${sl < 0 ? "s" : "n"}`,
        name: `${name} 翼角`,
        polygon: rect(frame, along, lateral, 1.6, 1.6),
        polygonTop: shift(rect(frame, along, lateral, 0.9, 0.9), frame, sa * 1.0, sl * 1.0),
        base: eaveBase + GATE_EAVE_THICKNESS - 0.2,
        height: 1.0,
      });
    }
  }
  return parts;
}

// ── 臺北郵局 ──────────────────────────────────────────────
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

function buildPostOffice(): Feature[] {
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

  // 正面柱廊：五開間的圓拱，柱身立於立面線、拱圈以階梯逼近
  const porchWidth = POST_BAYS * POST_BAY_SPACING;
  const pierLateral = -0.4;
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
          polygon: rect(
            frame,
            centre + side * (halfOpen + width / 2),
            pierLateral,
            width,
            2.2,
          ),
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

// ── 新光人壽保險摩天大樓（新光三越站前店） ────────────────
/** 裙樓與塔樓各段的高程（公尺）；屋頂 238.15、尖頂 244.15 取自文獻。 */
const SK_PODIUM_PLINTH = 7.0;
const SK_PODIUM_TOP = 43.0;
const SK_PODIUM_CORNICE = 46.0;
const SK_PODIUM_PARAPET = 47.5;
const SK_SHAFT_TOP = 188.0;
const SK_ROOF = 238.15;
const SK_SPIRE = 244.15;
/** 塔樓中段的機電層帶高程（公尺）。 */
const SK_BAND_LEVELS = [60, 112, 160];

const SK_NOTE =
  "新光人壽保險摩天大樓 1993 年完工，地上 51 層，屋頂 238.15 公尺、尖頂 244.15 公尺" +
  "（中文維基百科「新光人壽保險摩天大樓」條目）。裙樓為新光三越臺北站前店。" +
  "裙樓平面取自 OSM 輪廓、塔樓平面取自禁限建公告圖的房屋面（四角內凹），" +
  "塔冠逐層出簷收分的段落高程依外觀照片比例換算，為推估值。";

function buildShinKong(): Feature[] {
  const podium = outline(SHIN_KONG);
  const tower = dortsFaceIn(podium) ?? insetRing(podium, 6);
  const axis = minAreaRect(tower);
  const frame: Frame = { origin: axis.center, bearing: axis.bearing };
  const name = "新光人壽保險摩天大樓";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("shin-kong", SK_NOTE, input));
  };

  // 裙樓：新光三越站前店
  add({
    id: "podium/plinth",
    name: `${name} 裙樓基座`,
    polygon: insetRing(podium, -0.6),
    base: 0,
    height: SK_PODIUM_PLINTH,
  });
  add({
    id: "podium/body",
    name: `${name} 裙樓`,
    polygon: podium,
    base: SK_PODIUM_PLINTH,
    height: SK_PODIUM_TOP - SK_PODIUM_PLINTH,
  });
  add({
    id: "podium/cornice",
    name: `${name} 裙樓簷口`,
    polygon: insetRing(podium, -0.9),
    base: SK_PODIUM_TOP,
    height: SK_PODIUM_CORNICE - SK_PODIUM_TOP,
  });
  add({
    id: "podium/parapet",
    name: `${name} 裙樓女兒牆`,
    polygon: insetRing(podium, 1.4),
    base: SK_PODIUM_CORNICE,
    height: SK_PODIUM_PARAPET - SK_PODIUM_CORNICE,
  });

  // 塔身與機電層帶
  add({
    id: "tower/shaft",
    name: `${name} 塔身`,
    polygon: tower,
    base: 0,
    height: SK_SHAFT_TOP,
  });
  SK_BAND_LEVELS.forEach((level, i) => {
    add({
      id: `tower/band/${i}`,
      name: `${name} 設備層`,
      polygon: insetRing(tower, -0.45),
      base: level,
      height: 2.2,
    });
  });

  // 塔冠：三層出簷收分，頂部為攢尖頂與尖塔
  const crown: { id: string; name: string; inset: number; base: number; height: number }[] = [
    { id: "crown/cornice-1", name: "塔冠簷口", inset: -1.6, base: SK_SHAFT_TOP, height: 2.5 },
    { id: "crown/body-1", name: "塔冠", inset: 2.2, base: 190.5, height: 11.5 },
    { id: "crown/cornice-2", name: "塔冠簷口", inset: 0.6, base: 202, height: 2.5 },
    { id: "crown/body-2", name: "塔冠", inset: 5.0, base: 204.5, height: 10.5 },
    { id: "crown/cornice-3", name: "塔冠簷口", inset: 3.4, base: 215, height: 2.5 },
  ];
  for (const level of crown) {
    add({
      id: level.id,
      name: `${name} ${level.name}`,
      polygon: insetRing(tower, level.inset),
      base: level.base,
      height: level.height,
    });
  }
  // 頂層觀景層與攢尖屋頂以矩形收頭，避免內縮過深使平面退化成細長條
  const lanternL = axis.length * 0.42;
  const lanternW = axis.width * 0.52;
  add({
    id: "crown/lantern",
    name: `${name} 頂層`,
    polygon: rect(frame, 0, 0, lanternL, lanternW),
    base: 217.5,
    height: 12.5,
  });
  add({
    id: "crown/lantern-cornice",
    name: `${name} 頂層簷口`,
    polygon: rect(frame, 0, 0, lanternL + 2.4, lanternW + 2.4),
    base: 230,
    height: 2.0,
  });
  add({
    id: "crown/pyramid",
    name: `${name} 攢尖頂`,
    polygon: rect(frame, 0, 0, lanternL, lanternW),
    polygonTop: rect(frame, 0, 0, lanternL * 0.25, lanternW * 0.25),
    base: 232,
    height: SK_ROOF - 232,
  });
  add({
    id: "crown/spire",
    name: `${name} 尖頂`,
    polygon: rect(frame, 0, 0, 1.4, 1.4),
    base: SK_ROOF,
    height: SK_SPIRE - SK_ROOF,
  });
  return parts;
}

// ── 臺北車站（第四代站體） ────────────────────────────────
/** 文獻值：站體長 149 公尺、寬 110 公尺、高 48 公尺，地上 6 層。 */
const STATION_LENGTH = 149;
const STATION_WIDTH = 110;
const STATION_TOP = 48;
/** 台基、柱列與主量體的高程（公尺）。 */
const STATION_TERRACE = 1.4;
const STATION_BODY_BASE = 12.5;
const STATION_WALL_TOP = 34.0;
const STATION_EAVE_TOP = 36.6;
/** 外柱的斷面與柱距（公尺）。 */
const STATION_PIER = 1.9;
const STATION_PIER_SPACING = 9.3;
/** 屋簷出挑距離與屋頂兩段斜面的內收量（公尺）。 */
const STATION_EAVE_REACH = 3.0;
const STATION_ROOF_INSET = [11.5, 16.5];

const STATION_NOTE =
  "第四代臺北車站 1989 年啟用，長 149 公尺、寬 110 公尺、高 48 公尺、地上 6 層" +
  "（中文維基百科「臺北車站」條目）。外觀為四周出柱列的方正量體，上覆大跨距的四坡屋頂。" +
  "量體中心與方位取自 OSM 輪廓，柱距、樓層分段與屋頂斜度依外觀照片比例換算，為推估值。";

function buildTaipeiStation(): Feature[] {
  const ring = outline(TAIPEI_STATION);
  const axis = minAreaRect(ring);
  const frame: Frame = { origin: axis.center, bearing: axis.bearing };
  const name = "臺北車站";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("taipei-station", STATION_NOTE, input));
  };

  // 站前平臺：OSM 輪廓比站體本身大一圈，視為四周的平臺與雨庇範圍
  add({
    id: "terrace",
    name: `${name} 平臺`,
    polygon: ring,
    base: 0,
    height: STATION_TERRACE,
  });
  // 一、二層退縮於柱列之後
  add({
    id: "arcade-wall",
    name: `${name} 一二層`,
    polygon: rect(frame, 0, 0, STATION_LENGTH - 5, STATION_WIDTH - 5),
    base: STATION_TERRACE,
    height: STATION_BODY_BASE - STATION_TERRACE,
  });
  // 三至六層主量體，牆面退於樓層帶與外柱之後
  add({
    id: "body",
    name: `${name} 三至六層`,
    polygon: rect(frame, 0, 0, STATION_LENGTH - 1.6, STATION_WIDTH - 1.6),
    base: STATION_BODY_BASE,
    height: STATION_WALL_TOP - STATION_BODY_BASE,
  });

  // 柱列：一二層為粗壯的外柱，三層以上換成較細的壁柱，四角則為厚實的角柱
  const longCount = Math.round(STATION_LENGTH / STATION_PIER_SPACING);
  const shortCount = Math.round(STATION_WIDTH / STATION_PIER_SPACING);
  const longStep = STATION_LENGTH / longCount;
  const shortStep = STATION_WIDTH / shortCount;
  const arcadeTop = STATION_BODY_BASE + 1.1;
  for (let i = 0; i < longCount; i++) {
    const along = -STATION_LENGTH / 2 + (i + 0.5) * longStep;
    for (const side of [-1, 1]) {
      add({
        id: `pier/long/${i}/${side < 0 ? "s" : "n"}`,
        name: `${name} 外柱`,
        polygon: rect(frame, along, (side * STATION_WIDTH) / 2, STATION_PIER, STATION_PIER),
        base: STATION_TERRACE,
        height: arcadeTop - STATION_TERRACE,
      });
    }
  }
  for (let i = 0; i < shortCount; i++) {
    const lateral = -STATION_WIDTH / 2 + (i + 0.5) * shortStep;
    for (const side of [-1, 1]) {
      add({
        id: `pier/short/${i}/${side < 0 ? "w" : "e"}`,
        name: `${name} 外柱`,
        polygon: rect(frame, (side * STATION_LENGTH) / 2, lateral, STATION_PIER, STATION_PIER),
        base: STATION_TERRACE,
        height: arcadeTop - STATION_TERRACE,
      });
    }
  }
  // 上層壁柱：柱距取外柱的一半，斷面較薄，與樓層帶織成格狀立面
  for (let i = 0; i < longCount * 2; i++) {
    const along = -STATION_LENGTH / 2 + (i + 0.5) * (longStep / 2);
    for (const side of [-1, 1]) {
      add({
        id: `pilaster/long/${i}/${side < 0 ? "s" : "n"}`,
        name: `${name} 壁柱`,
        polygon: rect(frame, along, (side * STATION_WIDTH) / 2, 1.1, 1.3),
        base: STATION_BODY_BASE,
        height: STATION_WALL_TOP - STATION_BODY_BASE,
      });
    }
  }
  for (let i = 0; i < shortCount * 2; i++) {
    const lateral = -STATION_WIDTH / 2 + (i + 0.5) * (shortStep / 2);
    for (const side of [-1, 1]) {
      add({
        id: `pilaster/short/${i}/${side < 0 ? "w" : "e"}`,
        name: `${name} 壁柱`,
        polygon: rect(frame, (side * STATION_LENGTH) / 2, lateral, 1.3, 1.1),
        base: STATION_BODY_BASE,
        height: STATION_WALL_TOP - STATION_BODY_BASE,
      });
    }
  }
  for (const sa of [-1, 1]) {
    for (const sl of [-1, 1]) {
      add({
        id: `pier/corner/${sa < 0 ? "w" : "e"}${sl < 0 ? "s" : "n"}`,
        name: `${name} 角柱`,
        polygon: rect(
          frame,
          (sa * STATION_LENGTH) / 2,
          (sl * STATION_WIDTH) / 2,
          STATION_PIER * 1.9,
          STATION_PIER * 1.9,
        ),
        base: STATION_TERRACE,
        height: STATION_WALL_TOP - STATION_TERRACE,
      });
    }
  }

  // 樓層帶：略突出於壁柱的水平線腳，帶與帶之間即深凹的窗帶
  const bands = [STATION_BODY_BASE, 18.0, 23.5, 29.0, 32.6];
  bands.forEach((level, i) => {
    add({
      id: `band/${i}`,
      name: `${name} 樓層帶`,
      polygon: rect(frame, 0, 0, STATION_LENGTH + 0.7, STATION_WIDTH + 0.7),
      base: level,
      height: 1.4,
    });
  });

  // 出入口雨棚：每面三處
  for (const side of [-1, 1]) {
    for (const along of [-STATION_LENGTH / 3, 0, STATION_LENGTH / 3]) {
      add({
        id: `canopy/long/${side < 0 ? "s" : "n"}/${along.toFixed(0)}`,
        name: `${name} 出入口雨棚`,
        polygon: rect(frame, along, (side * (STATION_WIDTH + 3.4)) / 2, 8, 3.4),
        base: 4.6,
        height: 0.7,
      });
    }
    for (const lateral of [-STATION_WIDTH / 3, 0, STATION_WIDTH / 3]) {
      add({
        id: `canopy/short/${side < 0 ? "w" : "e"}/${lateral.toFixed(0)}`,
        name: `${name} 出入口雨棚`,
        polygon: rect(frame, (side * (STATION_LENGTH + 3.4)) / 2, lateral, 3.4, 8),
        base: 4.6,
        height: 0.7,
      });
    }
  }

  // 簷口與四坡屋頂
  const eaveL = STATION_LENGTH + 2 * STATION_EAVE_REACH;
  const eaveW = STATION_WIDTH + 2 * STATION_EAVE_REACH;
  add({
    id: "eave",
    name: `${name} 簷口`,
    polygon: rect(frame, 0, 0, eaveL, eaveW),
    base: STATION_WALL_TOP,
    height: STATION_EAVE_TOP - STATION_WALL_TOP,
  });
  let roofBase = STATION_EAVE_TOP;
  let lower = { length: eaveL, width: eaveW };
  const rises = [5.0, 4.0];
  STATION_ROOF_INSET.forEach((inset, i) => {
    const upper = { length: lower.length - 2 * inset, width: lower.width - 2 * inset };
    add({
      id: `roof/${i}`,
      name: `${name} 屋頂`,
      polygon: rect(frame, 0, 0, lower.length, lower.width),
      polygonTop: rect(frame, 0, 0, upper.length, upper.width),
      base: roofBase,
      height: rises[i],
    });
    roofBase += rises[i];
    lower = upper;
  });
  add({
    id: "roof/deck",
    name: `${name} 屋頂平臺`,
    polygon: rect(frame, 0, 0, lower.length, lower.width),
    base: roofBase,
    height: 0.8,
  });
  add({
    id: "roof/penthouse",
    name: `${name} 屋頂機房`,
    polygon: rect(frame, 0, 0, lower.length * 0.42, lower.width * 0.34),
    base: roofBase + 0.8,
    height: STATION_TOP - roofBase - 0.8,
  });
  return parts;
}

let cached: Feature[] | null = null;

/** 四座地標的細部量體。 */
export function buildLandmarks(): Feature[] {
  if (cached) return cached;
  cached = [...buildTaipeiStation(), ...buildPostOffice(), ...buildShinKong(), ...buildNorthGate()];
  return cached;
}

/**
 * 地標的認領範圍：形心落在其中的建物量體改由本模組的細部量體呈現。
 * 範圍即該地標的 OSM 輪廓，因此公告圖切成數塊的房屋面也會一併讓位。
 */
export function landmarkClaims(): Local[][] {
  return LANDMARK_MODEL_IDS.map((id) => outline(id));
}
