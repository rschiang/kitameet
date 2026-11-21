/** 臺北當代藝術館（原建成尋常小學校）：紅磚二層翼樓、兩坡瓦頂與中央鐘塔。 */
import type { Local } from "../../../geo/project.ts";
import type { Feature } from "../../schema.ts";
import {
  faceFrame,
  insetRing,
  mergedEdges,
  minAreaRect,
  outline,
  part,
  rect,
  towards,
  type Frame,
  type PartInput,
} from "./frame.ts";

export const MOCA_TAIPEI = "way/217690234";

/** 台基、兩層牆身、腰線與簷口的高程（公尺）。 */
const PLINTH_TOP = 0.95;
const GROUND_TOP = 5.5;
const BELT_BASE = 5.05;
const BELT_HEIGHT = 0.55;
const UPPER_TOP = 9.9;
const CORNICE_TOP = 10.9;
/** 台基、腰線與簷口自牆面外伸的距離（公尺）。 */
const PLINTH_REACH = 0.7;
const BAND_REACH = 0.25;
const CORNICE_REACH = 0.85;
/** 屋面出簷、翼樓屋脊升起與端部、中央屋頂的升起（公尺）。 */
const EAVE_REACH = 0.95;
const WING_RISE = 3.7;
const END_RISE = 4.0;
const CENTRE_WALL_TOP = 11.4;
const CENTRE_RISE = 4.2;
/** 屋脊帶的半寬與脊瓦厚度（公尺）。 */
const RIDGE_HALF = 0.2;
const RIDGE_THICKNESS = 0.45;
/** 老虎窗：沿翼樓南坡約每 12 公尺一座，坐落於坡面中段偏下。 */
const DORMER_SPACING = 12;
const DORMER_SLOPE_FRACTION = 0.55;
const DORMER_WIDTH = 2.6;
const DORMER_DEPTH = 1.7;
const DORMER_HEIGHT = 2.0;
/** 門廊（1960 年代增建的玄關）：外伸距離、柱數與各部高程（公尺）。 */
const PORCH_REACH = 5.0;
const PORCH_WIDTH_RATIO = 0.3;
const PORCH_TOP = 5.0;
const PORCH_CORNICE_HEIGHT = 1.0;
const PORCH_COLUMNS = 4;
const PORCH_COLUMN_SIZE = 1.1;
/** 鐘塔：塔身邊長取中央開間面寬的比例，自南牆內退，各部高程見下（公尺）。 */
const TOWER_SIDE_RATIO = 0.15;
const TOWER_SETBACK = 4.5;
const TOWER_SHAFT_TOP = 17.6;
const TOWER_CORNICE_TOP = 18.3;
const TOWER_SPIRE_TOP = 20.6;
const TOWER_FINIAL_TOP = 21.6;
const TOWER_FACE_BASE = 15.4;
const TOWER_FACE_HEIGHT = 1.8;
/** 外牆分段：與長軸夾角在此容差內者視為南北向外牆，短於此者視為轉折。 */
const PARALLEL_TOLERANCE = 0.5;
const MIN_BAY_SPAN = 6;

const MOCA_NOTE =
  "臺北當代藝術館為近藤十郎設計、1921 年落成的建成尋常小學校校舍，1945 年至 1994 年作為臺北市政府廳舍" +
  "（中文維基百科「台北當代藝術館」與「臺北市政府舊廈」條目）：二層紅磚牆身配白色水平飾帶的辰野式立面，" +
  "南面主樓為一字形長條，兩翼覆黑色波浪陶瓦的兩坡頂並開老虎窗，兩端為略突出的端部量體，" +
  "中央入口量體之上立方形鐘塔並覆銅瓦尖頂。平面取自 OSM 輪廓，端部、翼樓與中央入口的開間依輪廓南北外牆的各段退縮量推算。" +
  "條目未載總高，各部高度依正立面照片換算：以中央開間面寬 41.5 公尺為比例尺，量得簷口約 10.9 公尺、" +
  "鐘塔尖飾約 21.6 公尺（鐘塔退在主樓之後，量測時已依其與正立面的距離差修正透視），" +
  "屋脊、老虎窗、門廊與鐘塔各段尺寸同為推估值。";

/** 沿長軸的開間：南北兩面外牆配對後即端部、翼樓與中央入口。 */
interface Bay {
  /** 開間中心沿長軸的位置與面寬（公尺）。 */
  centre: number;
  span: number;
  /** 南北兩面外牆在 frame 中的 lateral 座標（公尺），南為正。 */
  south: number;
  north: number;
}

/** 輪廓中與長軸平行的外牆段，依重疊範圍配對為開間。 */
function facadeBays(ring: Local[], frame: Frame): Bay[] {
  const rad = (frame.bearing * Math.PI) / 180;
  const local = (p: Local): { along: number; lateral: number } => {
    const dx = p[0] - frame.origin[0];
    const dy = p[1] - frame.origin[1];
    return {
      along: dx * Math.cos(rad) + dy * Math.sin(rad),
      lateral: -dx * Math.sin(rad) + dy * Math.cos(rad),
    };
  };
  const runs = mergedEdges(ring)
    .map(({ a, b }) => ({ a: local(a), b: local(b) }))
    .filter((edge) => Math.abs(edge.a.lateral - edge.b.lateral) < PARALLEL_TOLERANCE)
    .map((edge) => ({
      start: Math.min(edge.a.along, edge.b.along),
      end: Math.max(edge.a.along, edge.b.along),
      lateral: (edge.a.lateral + edge.b.lateral) / 2,
    }))
    .filter((run) => run.end - run.start > MIN_BAY_SPAN);
  const south = runs.filter((run) => run.lateral > 0).sort((p, q) => p.start - q.start);
  const north = runs.filter((run) => run.lateral < 0);
  if (south.length === 0 || north.length === 0) throw new Error("輪廓分不出南北外牆");
  const overlap = (a: { start: number; end: number }, b: { start: number; end: number }): number =>
    Math.min(a.end, b.end) - Math.max(a.start, b.start);
  return south.map((run) => {
    const mate = north.reduce((best, other) =>
      overlap(other, run) > overlap(best, run) ? other : best,
    );
    return {
      centre: (run.start + run.end) / 2,
      span: run.end - run.start,
      south: run.lateral,
      north: mate.lateral,
    };
  });
}

export function buildMocaTaipei(): Feature[] {
  const ring = outline(MOCA_TAIPEI);
  const axis = minAreaRect(ring);
  // 正面朝南、面向長安西路：取中央入口量體的南牆，lateral 朝外
  const { frame: facade } = faceFrame(ring, towards(ring, -90), 20);
  // 長軸與正立面平行，沿用正立面的方位，使兩套座標系的 lateral 同為朝南
  const frame: Frame = { origin: axis.center, bearing: facade.bearing };
  const bays = facadeBays(ring, frame);
  // 五段對稱的立面：最寬者為中央入口，最外兩段為端部，其餘為翼樓
  const centre = bays.reduce((best, bay) => (bay.span > best.span ? bay : best));
  const ends = [bays[0], bays[bays.length - 1]];
  const wings = bays.filter((bay) => bay !== centre && !ends.includes(bay));
  const name = "臺北當代藝術館";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("moca-taipei", MOCA_NOTE, input));
  };

  // 台基、兩層紅磚牆身、白色水平飾帶與簷口
  add({
    id: "base",
    name: `${name} 台基`,
    polygon: insetRing(ring, -PLINTH_REACH),
    base: 0,
    height: PLINTH_TOP,
  });
  add({
    id: "wall/ground",
    name: `${name} 一層牆身`,
    polygon: ring,
    base: 0,
    height: GROUND_TOP,
  });
  add({
    id: "belt",
    name: `${name} 腰線`,
    polygon: insetRing(ring, -BAND_REACH),
    base: BELT_BASE,
    height: BELT_HEIGHT,
  });
  add({
    id: "wall/upper",
    name: `${name} 二層牆身`,
    polygon: ring,
    base: GROUND_TOP,
    height: UPPER_TOP - GROUND_TOP,
  });
  add({
    id: "cornice",
    name: `${name} 簷口`,
    polygon: insetRing(ring, -CORNICE_REACH),
    base: UPPER_TOP,
    height: CORNICE_TOP - UPPER_TOP,
  });

  // 兩端端部量體：女兒牆較翼樓高一段，使端部在立面上略為突出
  ends.forEach((bay, index) => {
    const depth = bay.south - bay.north;
    const middle = (bay.south + bay.north) / 2;
    add({
      id: `block/${index}`,
      name: `${name} 端部量體`,
      polygon: rect(frame, bay.centre, middle, bay.span, depth),
      base: UPPER_TOP,
      height: CORNICE_TOP + 0.6 - UPPER_TOP,
    });
    add({
      id: `roof/end/${index}`,
      name: `${name} 端部屋頂`,
      polygon: rect(frame, bay.centre, middle, bay.span + 2 * EAVE_REACH, depth + 2 * EAVE_REACH),
      polygonTop: rect(frame, bay.centre, middle, bay.span * 0.3, depth * 0.22),
      base: CORNICE_TOP + 0.6,
      height: END_RISE,
    });
  });

  // 翼樓兩坡頂：南北各一段斜面收至屋脊，屋脊另出脊瓦
  wings.forEach((bay, index) => {
    const ridge = (bay.south + bay.north) / 2;
    const eaveSouth = bay.south + EAVE_REACH;
    const eaveNorth = bay.north - EAVE_REACH;
    const length = bay.span + 2 * EAVE_REACH;
    add({
      id: `roof/wing/${index}/south`,
      name: `${name} 翼樓南坡`,
      polygon: rect(frame, bay.centre, (eaveSouth + ridge) / 2, length, eaveSouth - ridge),
      polygonTop: rect(frame, bay.centre, ridge + RIDGE_HALF, length, 2 * RIDGE_HALF),
      base: CORNICE_TOP,
      height: WING_RISE,
    });
    add({
      id: `roof/wing/${index}/north`,
      name: `${name} 翼樓北坡`,
      polygon: rect(frame, bay.centre, (eaveNorth + ridge) / 2, length, ridge - eaveNorth),
      polygonTop: rect(frame, bay.centre, ridge - RIDGE_HALF, length, 2 * RIDGE_HALF),
      base: CORNICE_TOP,
      height: WING_RISE,
    });
    add({
      id: `roof/wing/${index}/ridge`,
      name: `${name} 翼樓屋脊`,
      polygon: rect(frame, bay.centre, ridge, bay.span, 4 * RIDGE_HALF),
      base: CORNICE_TOP + WING_RISE - RIDGE_THICKNESS / 2,
      height: RIDGE_THICKNESS,
    });

    // 老虎窗：坐落於南坡中段，窗面略向外傾的拱形窗頭以上緣收窄表示
    const dormers = Math.max(2, Math.round(bay.span / DORMER_SPACING));
    const slope = eaveSouth - ridge;
    const lateral = ridge + slope * DORMER_SLOPE_FRACTION;
    const seat = CORNICE_TOP + WING_RISE * (1 - DORMER_SLOPE_FRACTION);
    for (let i = 0; i < dormers; i++) {
      const along = bay.centre - bay.span / 2 + ((i + 0.5) * bay.span) / dormers;
      add({
        id: `roof/wing/${index}/dormer/${i}`,
        name: `${name} 老虎窗`,
        polygon: rect(frame, along, lateral, DORMER_WIDTH, DORMER_DEPTH),
        polygonTop: rect(frame, along, lateral, DORMER_WIDTH * 0.7, DORMER_DEPTH),
        base: seat,
        height: DORMER_HEIGHT,
      });
    }
  });

  // 中央入口量體：牆身較翼樓高出一段，其上為四坡屋頂與弧形山頭
  const centreDepth = centre.south - centre.north;
  const centreMiddle = (centre.south + centre.north) / 2;
  add({
    id: "entrance/body",
    name: `${name} 中央入口量體`,
    polygon: rect(frame, centre.centre, centreMiddle, centre.span, centreDepth),
    base: UPPER_TOP,
    height: CENTRE_WALL_TOP - UPPER_TOP,
  });
  add({
    id: "entrance/cornice",
    name: `${name} 中央簷口`,
    polygon: rect(
      frame,
      centre.centre,
      centreMiddle,
      centre.span + 2 * CORNICE_REACH,
      centreDepth + 2 * CORNICE_REACH,
    ),
    base: CENTRE_WALL_TOP,
    height: 0.8,
  });
  add({
    id: "roof/centre",
    name: `${name} 中央屋頂`,
    polygon: rect(
      frame,
      centre.centre,
      centreMiddle,
      centre.span + 2 * EAVE_REACH,
      centreDepth + 2 * EAVE_REACH,
    ),
    polygonTop: rect(frame, centre.centre, centreMiddle, centre.span * 0.35, centreDepth * 0.2),
    base: CENTRE_WALL_TOP + 0.8,
    height: CENTRE_RISE,
  });
  add({
    id: "roof/pediment",
    name: `${name} 弧形山頭`,
    polygon: rect(facade, 0, 0.5, centre.span * 0.33, 1.3),
    polygonTop: rect(facade, 0, 0.5, centre.span * 0.18, 1.3),
    base: CENTRE_WALL_TOP,
    height: 2.1,
  });

  // 門廊：外伸的玄關量體、一列圓柱與其上的簷板
  const porchWidth = centre.span * PORCH_WIDTH_RATIO;
  add({
    id: "porch/body",
    name: `${name} 門廊`,
    polygon: rect(facade, 0, PORCH_REACH / 2, porchWidth, PORCH_REACH),
    base: 0,
    height: PORCH_TOP,
  });
  const columnSpan = porchWidth * 0.85;
  for (let i = 0; i < PORCH_COLUMNS; i++) {
    add({
      id: `porch/column/${i}`,
      name: `${name} 門廊柱`,
      polygon: rect(
        facade,
        -columnSpan / 2 + (i * columnSpan) / (PORCH_COLUMNS - 1),
        PORCH_REACH - PORCH_COLUMN_SIZE / 2,
        PORCH_COLUMN_SIZE,
        PORCH_COLUMN_SIZE,
      ),
      base: PLINTH_TOP,
      height: PORCH_TOP - PLINTH_TOP,
    });
  }
  add({
    id: "porch/cornice",
    name: `${name} 門廊簷板`,
    polygon: rect(facade, 0, PORCH_REACH / 2, porchWidth + 1.0, PORCH_REACH + 0.8),
    base: PORCH_TOP,
    height: PORCH_CORNICE_HEIGHT,
  });

  // 鐘塔：方形塔身自中央屋面升起，四面鐘面之上為簷口、銅瓦尖頂與尖飾
  const towerSide = centre.span * TOWER_SIDE_RATIO;
  add({
    id: "tower/shaft",
    name: `${name} 鐘塔樓身`,
    polygon: rect(facade, 0, -TOWER_SETBACK, towerSide, towerSide),
    base: UPPER_TOP,
    height: TOWER_SHAFT_TOP - UPPER_TOP,
  });
  add({
    id: "tower/face/south",
    name: `${name} 鐘面`,
    polygon: rect(facade, 0, -TOWER_SETBACK + towerSide / 2, towerSide * 0.6, 0.3),
    base: TOWER_FACE_BASE,
    height: TOWER_FACE_HEIGHT,
  });
  for (const side of [-1, 1]) {
    add({
      id: `tower/face/${side < 0 ? "west" : "east"}`,
      name: `${name} 鐘面`,
      polygon: rect(facade, (side * towerSide) / 2, -TOWER_SETBACK, 0.3, towerSide * 0.6),
      base: TOWER_FACE_BASE,
      height: TOWER_FACE_HEIGHT,
    });
  }
  add({
    id: "tower/cornice",
    name: `${name} 鐘塔簷口`,
    polygon: rect(facade, 0, -TOWER_SETBACK, towerSide + 1.0, towerSide + 1.0),
    base: TOWER_SHAFT_TOP,
    height: TOWER_CORNICE_TOP - TOWER_SHAFT_TOP,
  });
  add({
    id: "tower/spire",
    name: `${name} 鐘塔尖頂`,
    polygon: rect(facade, 0, -TOWER_SETBACK, towerSide + 0.4, towerSide + 0.4),
    polygonTop: rect(facade, 0, -TOWER_SETBACK, towerSide * 0.18, towerSide * 0.18),
    base: TOWER_CORNICE_TOP,
    height: TOWER_SPIRE_TOP - TOWER_CORNICE_TOP,
  });
  add({
    id: "tower/finial",
    name: `${name} 鐘塔尖飾`,
    polygon: rect(facade, 0, -TOWER_SETBACK, 0.35, 0.35),
    base: TOWER_SPIRE_TOP,
    height: TOWER_FINIAL_TOP - TOWER_SPIRE_TOP,
  });
  return parts;
}

export function claim(): Local[] {
  return outline(MOCA_TAIPEI);
}
