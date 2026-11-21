/** 臺北中山堂（原臺北公會堂）：石造台基、淺綠面磚牆身、三拱門廊與集會堂上方的四坡瓦頂。 */
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
  type Frame,
  type PartInput,
} from "./frame.ts";

export const ZHONGSHAN_HALL = "way/232326529";

/**
 * 各部高程（公尺，地面為 0）。
 *
 * 維基百科僅載寬 60.5 公尺、側深 113 公尺與四層樓，未載總高，因此改以正立面照片換算：
 * 照片中東面門廊台基的面寬即 {@link faceFrame} 量得的正面段長度（約 17.5 公尺），
 * 以該寬度為比例尺量得台基頂約 6.6 公尺、側翼女兒牆頂約 15 公尺、正面山牆頂約 18.4 公尺。
 */
const PODIUM_TOP = 6.6;
const PODIUM_CORNICE = 0.6;
const SECOND_TOP = 10.5;
const BELT_BASE = 10.1;
const BELT_HEIGHT = 0.6;
const THIRD_TOP = 13.6;
const EAVE_HEIGHT = 0.6;
const PARAPET_TOP = 15.1;
const GABLE_TOP = 18.4;
/** 集會堂量體與其四坡瓦頂：照片中屋頂多隱於山牆之後，高度為推估。 */
const HALL_TOP = 17.4;
const HALL_CORNICE = 0.6;
const RIDGE_TOP = 20.6;
/** 正面三拱門廊的開間數、起拱高與拱圈的階梯段數。 */
const PORCH_BAYS = 3;
const PORCH_PIER_RATIO = 0.3;
const ARCH_SPRING = 3.5;
const ARCH_STEPS = 2;
/** 門廊上方雨庇的底高與厚度（公尺）。 */
const CANOPY_BASE = 8.6;
const CANOPY_THICKNESS = 0.8;
/** 山牆拱窗帶的開間數與窗間柱尺寸（公尺）。 */
const WINDOW_BAYS = 6;
const MULLION_WIDTH = 0.7;
/** 集會堂量體占輪廓長寬的比例：依公告的「主體大積木」配置推估。 */
const HALL_ALONG_RATIO = -0.18;
const HALL_LENGTH_RATIO = 0.45;
const HALL_WIDTH_RATIO = 0.42;

const HALL_NOTE =
  "臺北中山堂原為臺北公會堂，1936 年落成，由總督府營繕課技師井手薰設計（中文維基百科「中山堂 (臺北市)」條目）：" +
  "四層鋼筋混凝土造，外牆貼北投窯場生產的淺綠色面磚，窗洞採尖拱與馬蹄拱，女兒牆以紅陶瓦壓頂，屋頂為低緩的四坡瓦頂。" +
  "正面朝東面對中山堂廣場與延平南路，入口為厚重的三拱門廊，門廊上方設雨庇，其後為帶拱窗帶與圓窗的山牆。" +
  "平面取自 OSM 輪廓，方位與集會堂量體依最小外接矩形推算；" +
  "維基百科載寬 60.5 公尺、側深 113 公尺與四層樓而未載總高，各部高度改依正立面照片，" +
  "以正面門廊台基的面寬為比例尺換算，得台基頂約 6.6 公尺、側翼女兒牆頂約 15 公尺、山牆頂約 18.4 公尺，" +
  "集會堂上方的高起量體與四坡屋頂多隱於山牆之後，其高度為推估值。";

export function buildZhongshanHall(): Feature[] {
  const ring = outline(ZHONGSHAN_HALL);
  const axis = minAreaRect(ring);
  const axisFrame: Frame = { origin: axis.center, bearing: axis.bearing };
  // 正面朝東：取朝向延平南路一側、長度足夠的外牆為門廊與山牆的基準
  const { frame, length: facade } = faceFrame(ring, towards(ring, 0), 15);
  const name = "臺北中山堂";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("zhongshan-hall", HALL_NOTE, input));
  };

  // 台基與逐層內縮的牆身：一層為石造台基，二三層貼淺綠面磚並以紅磚腰線分隔
  add({
    id: "base/podium",
    name: `${name} 台基`,
    polygon: ring,
    base: 0,
    height: PODIUM_TOP,
  });
  add({
    id: "base/cornice",
    name: `${name} 台基壓簷`,
    polygon: insetRing(ring, -0.6),
    base: PODIUM_TOP - PODIUM_CORNICE,
    height: PODIUM_CORNICE,
  });
  add({
    id: "wall/second",
    name: `${name} 二層牆身`,
    polygon: insetRing(ring, 1.0),
    base: PODIUM_TOP,
    height: SECOND_TOP - PODIUM_TOP,
  });
  add({
    id: "belt/second",
    name: `${name} 二層腰線`,
    polygon: insetRing(ring, 0.6),
    base: BELT_BASE,
    height: BELT_HEIGHT,
  });
  add({
    id: "wall/third",
    name: `${name} 三層牆身`,
    polygon: insetRing(ring, 2.0),
    base: SECOND_TOP,
    height: THIRD_TOP - SECOND_TOP,
  });
  add({
    id: "cornice/main",
    name: `${name} 簷口`,
    polygon: insetRing(ring, 1.4),
    base: THIRD_TOP,
    height: EAVE_HEIGHT,
  });
  add({
    id: "parapet/wing",
    name: `${name} 側翼女兒牆`,
    polygon: insetRing(ring, 2.8),
    base: THIRD_TOP + EAVE_HEIGHT,
    height: PARAPET_TOP - THIRD_TOP - EAVE_HEIGHT,
  });

  // 集會堂：中後段的高起量體，上覆兩段四坡瓦頂與正脊
  const hallAlong = axis.length * HALL_ALONG_RATIO;
  const hallLength = axis.length * HALL_LENGTH_RATIO;
  const hallWidth = axis.width * HALL_WIDTH_RATIO;
  add({
    id: "hall/wall",
    name: `${name} 集會堂牆身`,
    polygon: rect(axisFrame, hallAlong, 0, hallLength, hallWidth),
    base: THIRD_TOP,
    height: HALL_TOP - THIRD_TOP,
  });
  add({
    id: "hall/cornice",
    name: `${name} 集會堂簷口`,
    polygon: rect(axisFrame, hallAlong, 0, hallLength + 1.6, hallWidth + 1.6),
    base: HALL_TOP,
    height: HALL_CORNICE,
  });
  // 低緩的四坡瓦頂：下段緩、上段略陡，以上緣輪廓收分放樣
  const slopes: { rise: number; inset: number }[] = [
    { rise: 1.4, inset: 3.2 },
    { rise: 0.8, inset: 4.0 },
  ];
  let roofBase = HALL_TOP + HALL_CORNICE;
  let lower = { length: hallLength + 2.4, width: hallWidth + 2.4 };
  slopes.forEach((slope, i) => {
    const upper = {
      length: lower.length - 2 * slope.inset,
      width: lower.width - 2 * slope.inset,
    };
    add({
      id: `roof/slope/${i}`,
      name: `${name} 屋頂斜面`,
      polygon: rect(axisFrame, hallAlong, 0, lower.length, lower.width),
      polygonTop: rect(axisFrame, hallAlong, 0, upper.length, upper.width),
      base: roofBase,
      height: slope.rise,
    });
    roofBase += slope.rise;
    lower = upper;
  });
  add({
    id: "roof/ridge",
    name: `${name} 屋脊`,
    polygon: rect(axisFrame, hallAlong, 0, lower.length, 1.2),
    base: roofBase,
    height: RIDGE_TOP - roofBase,
  });

  // 正面三拱門廊：柱墩與拱圈以階梯逼近貼在台基之前
  const spacing = facade / PORCH_BAYS;
  const pier = spacing * PORCH_PIER_RATIO;
  const porchSpan = (PORCH_BAYS - 1) * spacing;
  for (let i = 0; i <= PORCH_BAYS; i++) {
    add({
      id: `porch/pier/${i}`,
      name: `${name} 門廊柱墩`,
      polygon: rect(frame, -porchSpan / 2 - spacing / 2 + i * spacing, -0.4, pier, 2.0),
      base: 0,
      height: PODIUM_TOP - PODIUM_CORNICE,
    });
  }
  const clear = spacing - pier;
  const archRadius = clear / 2;
  const archStep = archRadius / ARCH_STEPS;
  for (let bay = 0; bay < PORCH_BAYS; bay++) {
    const centre = -porchSpan / 2 + bay * spacing;
    for (let k = 0; k < ARCH_STEPS; k++) {
      const top = ARCH_SPRING + (k + 1) * archStep;
      const halfOpen = Math.sqrt(
        Math.max(archRadius * archRadius - (top - ARCH_SPRING) ** 2, 0),
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
            -0.4,
            width,
            2.0,
          ),
          base: ARCH_SPRING + k * archStep,
          height: archStep,
        });
      }
    }
  }
  add({
    id: "porch/lintel",
    name: `${name} 門廊楣樑`,
    polygon: rect(frame, 0, -0.4, facade, 2.0),
    base: ARCH_SPRING + archRadius,
    height: PODIUM_TOP - ARCH_SPRING - archRadius,
  });
  add({
    id: "porch/canopy",
    name: `${name} 門廊雨庇`,
    polygon: rect(frame, 0, 0.6, facade * 1.05, 3.0),
    base: CANOPY_BASE,
    height: CANOPY_THICKNESS,
  });

  // 正面山牆：拱窗帶的窗間柱、窗楣與收分為三角形的山頭
  const windowSpacing = facade / WINDOW_BAYS;
  for (let i = 0; i <= WINDOW_BAYS; i++) {
    add({
      id: `facade/mullion/${i}`,
      name: `${name} 拱窗間柱`,
      polygon: rect(
        frame,
        -facade / 2 + i * windowSpacing,
        0.2,
        MULLION_WIDTH,
        0.8,
      ),
      base: SECOND_TOP + BELT_HEIGHT,
      height: THIRD_TOP - SECOND_TOP - BELT_HEIGHT,
    });
  }
  add({
    id: "facade/lintel",
    name: `${name} 拱窗楣帶`,
    polygon: rect(frame, 0, 0.2, facade, 0.8),
    base: THIRD_TOP - 0.5,
    height: 0.5,
  });
  add({
    id: "facade/gable",
    name: `${name} 山牆`,
    polygon: rect(frame, 0, -3.0, facade * 1.1, 6.0),
    polygonTop: rect(frame, 0, -3.0, facade * 0.18, 6.0),
    base: THIRD_TOP + EAVE_HEIGHT,
    height: GABLE_TOP - THIRD_TOP - EAVE_HEIGHT,
  });
  return parts;
}

export function claim(): Local[] {
  return outline(ZHONGSHAN_HALL);
}
