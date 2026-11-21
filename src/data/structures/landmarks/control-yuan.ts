/** 監察院（原臺北州廳）：曲尺形紅磚廳舍、轉角弧形門廳與銅皮扁圓頂。 */
import type { Local } from "../../../geo/project.ts";
import type { Feature } from "../../schema.ts";
import {
  faceFrame,
  insetRing,
  mergedEdges,
  outline,
  part,
  point,
  polygonArea,
  rect,
  towards,
  type Frame,
  type PartInput,
} from "./frame.ts";

export const CONTROL_YUAN = "way/225875957";

/** 兩翼各層的高程（公尺），地面為 0。 */
const CY_PLINTH_TOP = 1.2;
const CY_FIRST_TOP = 6.3;
const CY_SECOND_TOP = 11.8;
const CY_CORNICE_TOP = 13.2;
const CY_PARAPET_TOP = 14.3;
/** 兩翼屋頂的轉折與脊頂高程（公尺）：下段陡、上段緩的馬薩式斷面。 */
const CY_ROOF_BREAK = 17.2;
const CY_ROOF_RIDGE = 18.4;
/** 轉角門廳與圓頂各段的高程（公尺）。 */
const CY_HALL_TOP = 16.2;
const CY_HALL_CORNICE_TOP = 17.8;
const CY_DRUM_TOP = 19.0;
const CY_DOME_BREAK = 22.0;
const CY_DOME_TOP = 23.6;
const CY_FINIAL_TOP = 24.8;
/** 門廊托次坎柱的根數與柱徑（公尺）、圓頂半圓老虎窗的扇數：根數與扇數取自條目。 */
const CY_COLUMNS = 8;
const CY_COLUMN_SIZE = 1.1;
const CY_DORMERS = 12;
/** 弧形門廳的正面以此段數逼近圓弧；圓頂的水平斷面段數。 */
const CY_ARC_STEPS = 10;
const CY_DOME_SIDES = 24;
/** 兩翼屋頂老虎窗的數量：臨忠孝東路的北面較長，臨中山南路的西面較短。 */
const CY_NORTH_DORMERS = 5;
const CY_WEST_DORMERS = 2;

const CY_NOTE =
  "監察院廳舍原為臺北州廳，森山松之助設計、三浦慶次監造，1912 年起造、1915 年落成" +
  "（中文維基百科「監察院廳舍」條目）：後期文藝復興式，紅磚牆身配白色水平飾帶，" +
  "平面呈「曲尺」型，兩翼沿忠孝東路與中山南路展開並以端部山牆收頭，" +
  "九十度轉角處為凸出三層的弧形門廳，門廊立八根托次坎柱，門廳之上為銅皮扁圓頂並開十二扇半圓老虎窗。" +
  "平面取自 OSM 輪廓 way/225875957，轉角弧面、兩翼端牆與翼部進深 19 公尺皆由該輪廓量得。" +
  "高度以條目所載大廳挑高 15 公尺為比例尺：門廳三層簷下取 16.2 公尺（室內地坪高於地面 1.2 公尺），" +
  "其餘各部依正立面照片的比例換算，得兩翼簷口 13.2 公尺、屋脊 18.4 公尺、圓頂頂端 23.6 公尺，" +
  "連同頂端燈籠座的總高約 24.8 公尺。各層高程、屋頂斜度與圓頂收分均為推估值。";

/**
 * 弦長 `span`、矢高 `rise` 的圓弧在 `along` 處的橫向位置：
 * 最外點為 0、向內為負，供弧形門廳的正面與門廊柱列共用同一條弧。
 */
function arcLateral(span: number, rise: number, along: number): number {
  const radius = ((span / 2) ** 2 + rise * rise) / (2 * rise);
  return Math.sqrt(Math.max(radius * radius - along * along, 0)) - radius;
}

/**
 * 弧形門廳的平面：正面取圓弧、背面以一條直邊接回兩翼。
 * 頂點數固定為 `CY_ARC_STEPS + 3`，改變尺寸也一一對應，可直接搭配 polygonTop。
 */
function hallRing(frame: Frame, span: number, rise: number, depth: number): Local[] {
  const half = span / 2;
  const front = Array.from({ length: CY_ARC_STEPS + 1 }, (_, i) => {
    const along = -half + (span * i) / CY_ARC_STEPS;
    return point(frame, along, arcLateral(span, rise, along));
  });
  return [...front, point(frame, half, -depth), point(frame, -half, -depth)];
}

/** 以門廳座標系為基準的水平圓環，供鼓座、圓頂與燈籠座放樣。 */
function disc(frame: Frame, along: number, lateral: number, radius: number): Local[] {
  return Array.from({ length: CY_DOME_SIDES }, (_, i) => {
    const angle = (i / CY_DOME_SIDES) * Math.PI * 2;
    return point(frame, along + radius * Math.cos(angle), lateral + radius * Math.sin(angle));
  });
}

/**
 * 沿指定方位最外側的一段外牆：兩翼端部的山牆定位於此。
 * `faceFrame` 取的是最正對目標的一面，兩翼的同向外牆因此無法區分，端牆改以投影取極值。
 */
function endFace(
  ring: Local[],
  bearingDeg: number,
  minLength: number,
): { frame: Frame; length: number } {
  // 逆時針環的外法線在各邊右手側，順時針則在左手側
  const outwardTurn = polygonArea(ring) >= 0 ? -90 : 90;
  const direction = (bearingDeg * Math.PI) / 180;
  let best: { frame: Frame; length: number; reach: number } | undefined;
  for (const { a, b } of mergedEdges(ring)) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length < minLength) continue;
    const normal = (Math.atan2(dy, dx) * 180) / Math.PI + outwardTurn;
    if (Math.cos((normal * Math.PI) / 180 - direction) < 0.5) continue;
    const mid: Local = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const reach = mid[0] * Math.cos(direction) + mid[1] * Math.sin(direction);
    if (best !== undefined && reach <= best.reach) continue;
    best = { frame: { origin: mid, bearing: normal - 90 }, length, reach };
  }
  if (best === undefined) throw new Error("找不到朝向指定方位的端部外牆");
  return { frame: best.frame, length: best.length };
}

export function buildControlYuan(): Feature[] {
  const ring = outline(CONTROL_YUAN);
  // 兩條臨街立面：北面臨忠孝東路、西面臨中山南路
  const north = faceFrame(ring, towards(ring, 90), 20);
  const west = faceFrame(ring, towards(ring, 180), 15);
  // 兩翼端牆：各自沿該翼的軸向往外取最外側的一段
  const eastEnd = endFace(ring, north.frame.bearing, 10);
  const southEnd = endFace(ring, west.frame.bearing - 180, 8);
  const wingDepth = eastEnd.length;

  // 轉角門廳：朝向兩面外法線的角平分線，正對忠孝東路與中山南路的街口
  const toNorth = ((north.frame.bearing + 90) * Math.PI) / 180;
  const toWest = ((west.frame.bearing + 90) * Math.PI) / 180;
  const bisector = Math.atan2(
    Math.sin(toNorth) + Math.sin(toWest),
    Math.cos(toNorth) + Math.cos(toWest),
  );
  const outward: Local = [Math.cos(bisector), Math.sin(bisector)];
  let apex = ring[0];
  let apexReach = -Infinity;
  for (const p of ring) {
    const reach = p[0] * outward[0] + p[1] * outward[1];
    if (reach <= apexReach) continue;
    apexReach = reach;
    apex = p;
  }
  // 自弧面最外點向內一個半翼深之內的頂點視為門廳範圍，量其展開寬度與矢高
  const chord: Frame = { origin: apex, bearing: (bisector * 180) / Math.PI - 90 };
  const chordDir = (chord.bearing * Math.PI) / 180;
  const axis: Local = [Math.cos(chordDir), Math.sin(chordDir)];
  let left = Infinity;
  let right = -Infinity;
  let rise = 0;
  for (const p of ring) {
    const depth = apexReach - (p[0] * outward[0] + p[1] * outward[1]);
    if (depth > wingDepth / 2) continue;
    const along = (p[0] - apex[0]) * axis[0] + (p[1] - apex[1]) * axis[1];
    left = Math.min(left, along);
    right = Math.max(right, along);
    rise = Math.max(rise, depth);
  }
  const hallSpan = right - left;
  const hall: Frame = { origin: point(chord, (left + right) / 2, 0), bearing: chord.bearing };
  const hallCentre = -wingDepth / 2;

  const name = "監察院";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("control-yuan", CY_NOTE, input));
  };

  // 兩翼：台基、兩層牆身與其間的白色水平飾帶
  add({
    id: "base",
    name: `${name} 台基`,
    polygon: insetRing(ring, -0.9),
    base: 0,
    height: CY_PLINTH_TOP,
  });
  add({
    id: "base/cap",
    name: `${name} 台基壓頂`,
    polygon: insetRing(ring, -1.15),
    base: CY_PLINTH_TOP - 0.3,
    height: 0.35,
  });
  add({
    id: "wall/first",
    name: `${name} 一層牆身`,
    polygon: ring,
    base: CY_PLINTH_TOP,
    height: CY_FIRST_TOP - CY_PLINTH_TOP,
  });
  add({
    id: "belt/sill",
    name: `${name} 一層窗台飾帶`,
    polygon: insetRing(ring, -0.25),
    base: CY_PLINTH_TOP + 1.3,
    height: 0.4,
  });
  add({
    id: "belt/first",
    name: `${name} 一二層間飾帶`,
    polygon: insetRing(ring, -0.4),
    base: CY_FIRST_TOP - 0.5,
    height: 0.9,
  });
  add({
    id: "wall/second",
    name: `${name} 二層牆身`,
    polygon: ring,
    base: CY_FIRST_TOP,
    height: CY_SECOND_TOP - CY_FIRST_TOP,
  });
  add({
    id: "belt/second",
    name: `${name} 二層窗楣飾帶`,
    polygon: insetRing(ring, -0.25),
    base: CY_SECOND_TOP - 2.0,
    height: 0.4,
  });
  add({
    id: "cornice",
    name: `${name} 簷口`,
    polygon: insetRing(ring, -1.0),
    base: CY_SECOND_TOP,
    height: CY_CORNICE_TOP - CY_SECOND_TOP,
  });
  add({
    id: "parapet",
    name: `${name} 女兒牆`,
    polygon: insetRing(ring, 0.25),
    base: CY_CORNICE_TOP,
    height: CY_PARAPET_TOP - CY_CORNICE_TOP,
  });

  // 兩翼屋頂：下段陡、上段緩的兩折斜面，頂點數隨輪廓不變
  add({
    id: "roof/slope/lower",
    name: `${name} 屋頂陡斜段`,
    polygon: insetRing(ring, -0.6),
    polygonTop: insetRing(ring, 2.6),
    base: CY_CORNICE_TOP,
    height: CY_ROOF_BREAK - CY_CORNICE_TOP,
  });
  add({
    id: "roof/slope/upper",
    name: `${name} 屋頂緩斜段`,
    polygon: insetRing(ring, 2.6),
    polygonTop: insetRing(ring, 6.0),
    base: CY_ROOF_BREAK,
    height: CY_ROOF_RIDGE - CY_ROOF_BREAK,
  });

  // 屋頂老虎窗：沿兩面臨街立面等距排開，窗身略凸出牆面
  const dormerRows: { id: string; frame: Frame; length: number; count: number }[] = [
    { id: "north", frame: north.frame, length: north.length, count: CY_NORTH_DORMERS },
    { id: "west", frame: west.frame, length: west.length, count: CY_WEST_DORMERS },
  ];
  for (const row of dormerRows) {
    const spacing = (row.length * 0.86) / row.count;
    for (let i = 0; i < row.count; i++) {
      add({
        id: `roof/dormer/${row.id}/${i}`,
        name: `${name} 屋頂老虎窗`,
        polygon: rect(row.frame, (i - (row.count - 1) / 2) * spacing, -0.7, 1.7, 1.8),
        base: CY_CORNICE_TOP + 0.9,
        height: 2.1,
      });
    }
  }

  // 兩翼端部山牆：自簷口升起並向上收分
  const gables: { id: string; frame: Frame; length: number }[] = [
    { id: "east", frame: eastEnd.frame, length: eastEnd.length },
    { id: "south", frame: southEnd.frame, length: southEnd.length },
  ];
  for (const gable of gables) {
    const width = gable.length * 0.62;
    add({
      id: `gable/${gable.id}`,
      name: `${name} 翼端山牆`,
      polygon: rect(gable.frame, 0, -0.6, width, 2.0),
      polygonTop: rect(gable.frame, 0, -0.6, width * 0.35, 2.0),
      base: CY_CORNICE_TOP,
      height: 3.6,
    });
  }

  // 轉角門廳：台基、一二層弧形牆身、凸出的第三層與其簷口
  add({
    id: "hall/base",
    name: `${name} 門廳台基`,
    polygon: hallRing(hall, hallSpan + 1.8, rise + 0.9, wingDepth),
    base: 0,
    height: CY_PLINTH_TOP,
  });
  add({
    id: "hall/body",
    name: `${name} 門廳牆身`,
    polygon: hallRing(hall, hallSpan, rise, wingDepth),
    base: CY_PLINTH_TOP,
    height: CY_SECOND_TOP - CY_PLINTH_TOP,
  });
  add({
    id: "hall/third",
    name: `${name} 門廳三層`,
    polygon: hallRing(hall, hallSpan - 2.6, rise - 1.3, wingDepth - 1.3),
    base: CY_SECOND_TOP,
    height: CY_HALL_TOP - CY_SECOND_TOP,
  });
  add({
    id: "hall/cornice",
    name: `${name} 門廳簷口`,
    polygon: hallRing(hall, hallSpan - 1.4, rise - 0.7, wingDepth - 0.7),
    base: CY_HALL_TOP,
    height: CY_HALL_CORNICE_TOP - CY_HALL_TOP,
  });
  add({
    id: "hall/parapet",
    name: `${name} 門廳女兒牆`,
    polygon: hallRing(hall, hallSpan - 4.0, rise - 2.0, wingDepth - 2.0),
    base: CY_HALL_CORNICE_TOP,
    height: CY_DRUM_TOP - CY_HALL_CORNICE_TOP - 0.4,
  });

  // 門廊：沿同一條弧排開的八根托次坎柱與其上的楣樑
  const porchSpan = hallSpan * 0.72;
  const porchSpacing = porchSpan / (CY_COLUMNS - 1);
  for (let i = 0; i < CY_COLUMNS; i++) {
    const along = -porchSpan / 2 + i * porchSpacing;
    const lateral = arcLateral(hallSpan, rise, along) + 0.9;
    add({
      id: `porch/column/${i}`,
      name: `${name} 門廊柱`,
      polygon: rect(
        { origin: point(hall, along, lateral), bearing: hall.bearing },
        0,
        0,
        CY_COLUMN_SIZE,
        CY_COLUMN_SIZE,
      ),
      base: CY_PLINTH_TOP,
      height: CY_FIRST_TOP - CY_PLINTH_TOP,
    });
  }
  add({
    id: "porch/entablature",
    name: `${name} 門廊楣樑`,
    polygon: hallRing(hall, hallSpan + 1.4, rise + 0.7, wingDepth * 0.4),
    base: CY_FIRST_TOP,
    height: 1.1,
  });

  // 圓頂：鼓座、陡斜的下段、緩斜的上段與頂端燈籠座
  const drumRadius = hallSpan * 0.27;
  add({
    id: "dome/drum",
    name: `${name} 圓頂鼓座`,
    polygon: disc(hall, 0, hallCentre, drumRadius),
    base: CY_HALL_CORNICE_TOP,
    height: CY_DRUM_TOP - CY_HALL_CORNICE_TOP,
  });
  add({
    id: "dome/slope/lower",
    name: `${name} 圓頂陡斜段`,
    polygon: disc(hall, 0, hallCentre, drumRadius - 0.3),
    polygonTop: disc(hall, 0, hallCentre, drumRadius * 0.72),
    base: CY_DRUM_TOP,
    height: CY_DOME_BREAK - CY_DRUM_TOP,
  });
  add({
    id: "dome/slope/upper",
    name: `${name} 圓頂緩斜段`,
    polygon: disc(hall, 0, hallCentre, drumRadius * 0.72),
    polygonTop: disc(hall, 0, hallCentre, drumRadius * 0.2),
    base: CY_DOME_BREAK,
    height: CY_DOME_TOP - CY_DOME_BREAK,
  });
  for (let i = 0; i < CY_DORMERS; i++) {
    const angle = ((i + 0.5) / CY_DORMERS) * Math.PI * 2;
    const seat = point(
      hall,
      (drumRadius - 0.8) * Math.cos(angle),
      hallCentre + (drumRadius - 0.8) * Math.sin(angle),
    );
    add({
      id: `dome/dormer/${i}`,
      name: `${name} 圓頂老虎窗`,
      polygon: rect(
        { origin: seat, bearing: hall.bearing + (angle * 180) / Math.PI },
        0,
        0,
        1.5,
        1.6,
      ),
      base: CY_DRUM_TOP,
      height: 1.8,
    });
  }
  add({
    id: "dome/finial",
    name: `${name} 圓頂燈籠座`,
    polygon: disc(hall, 0, hallCentre, drumRadius * 0.16),
    base: CY_DOME_TOP,
    height: CY_FINIAL_TOP - CY_DOME_TOP,
  });
  return parts;
}

export function claim(): Local[] {
  return outline(CONTROL_YUAN);
}
