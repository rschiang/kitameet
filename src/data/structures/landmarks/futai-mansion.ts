/** 撫臺街洋樓：唭哩岸石砌的一層騎樓開三道半圓拱，二樓木造洗石子牆身，上覆復折式馬薩頂與老虎窗。 */
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

export const FUTAI_MANSION = "way/462816761";

/** 各段高程（公尺），地面為 0。 */
const PLINTH_TOP = 0.3; // 石砌台基
const ARCH_SPRING = 1.9; // 騎樓拱腳
const GROUND_TOP = 3.9; // 一層頂
const UPPER_TOP = 7.3; // 二層牆頂
const CORNICE_TOP = 7.7; // 簷口頂
const MANSARD_BREAK = 9.3; // 馬薩頂折點
const ROOF_TOP = 9.6; // 屋頂平台
const DORMER_TOP = 10.0; // 中央老虎窗頂
/** 騎樓進深與拱列（公尺）。 */
const ARCADE_DEPTH = 3.0;
const ARCH_BAYS = 3;
const PIER = 0.8;
/** 半圓拱以幾段階梯近似。 */
const ARCH_STEPS = 3;

const FUTAI_NOTE =
  "撫臺街洋樓建於 1910 年，原為土木包商高石組本社，1997 年指定為市定古蹟（臺北市文化局）：" +
  "一樓以唭哩岸石砌成，騎樓以三道半圓拱出入；二樓為木造、外飾洗石子；" +
  "屋頂為復折式馬薩頂，開三扇老虎窗。" +
  "平面取自 OSM 的 way/462816761（12.2 × 10.4 公尺），正面朝東臨延平南路。" +
  "查無高度文獻，各段高程依正立面照片、以正面寬 12.1 公尺為比例尺換算，中央老虎窗頂約 10 公尺，為推估值。";

export function buildFutaiMansion(): Feature[] {
  const ring = outline(FUTAI_MANSION);
  // 正面朝東臨延平南路；along 朝南、lateral 朝東
  const { frame: front, length: facade } = faceFrame(ring, towards(ring, 0), 10);
  const depth = minAreaRect(ring).width;
  const name = "撫臺街洋樓";
  const parts: Feature[] = [];
  const add = (input: PartInput): void => {
    parts.push(part("futai-mansion", FUTAI_NOTE, input));
  };

  add({
    id: "base/plinth",
    name: `${name} 台基`,
    polygon: insetRing(ring, -0.2),
    base: 0,
    height: PLINTH_TOP,
  });
  // 一層室內退在騎樓之後
  add({
    id: "body/ground",
    name: `${name} 一層石砌室內`,
    polygon: rect(
      front,
      0,
      -(ARCADE_DEPTH + (depth - ARCADE_DEPTH) / 2),
      facade,
      depth - ARCADE_DEPTH,
    ),
    base: PLINTH_TOP,
    height: GROUND_TOP - PLINTH_TOP,
  });

  // 騎樓：四根石柱間開三道半圓拱
  const pitch = (facade - PIER) / ARCH_BAYS;
  for (let i = 0; i <= ARCH_BAYS; i++) {
    add({
      id: `arcade/pier/${i}`,
      name: `${name} 騎樓石柱`,
      polygon: rect(front, -facade / 2 + PIER / 2 + i * pitch, -PIER / 2, PIER, PIER),
      base: PLINTH_TOP,
      height: GROUND_TOP - PLINTH_TOP,
    });
  }
  const clear = pitch - PIER;
  const radius = clear / 2;
  const step = radius / ARCH_STEPS;
  for (let bay = 0; bay < ARCH_BAYS; bay++) {
    const centre = -facade / 2 + PIER / 2 + (bay + 0.5) * pitch;
    for (let k = 0; k < ARCH_STEPS; k++) {
      const rise = (k + 1) * step;
      // 該層頂面處的淨開半寬
      const halfOpen = radius * Math.sqrt(Math.max(1 - (rise / radius) ** 2, 0));
      const width = radius - halfOpen;
      if (width < 0.05) continue;
      for (const side of [-1, 1]) {
        add({
          id: `arcade/arch/${bay}/${k}/${side < 0 ? "l" : "r"}`,
          name: `${name} 半圓拱`,
          polygon: rect(front, centre + side * (halfOpen + width / 2), -PIER / 2, width, PIER),
          base: ARCH_SPRING + k * step,
          height: step,
        });
      }
    }
  }
  add({
    id: "arcade/spandrel",
    name: `${name} 拱上牆`,
    polygon: rect(front, 0, -PIER / 2, facade, PIER),
    base: ARCH_SPRING + radius,
    height: GROUND_TOP - ARCH_SPRING - radius,
  });

  // 二樓蓋過騎樓，與一二層間的飾帶、簷口
  add({
    id: "body/upper",
    name: `${name} 二層洗石子牆身`,
    polygon: ring,
    base: GROUND_TOP,
    height: UPPER_TOP - GROUND_TOP,
  });
  add({
    id: "belt/first",
    name: `${name} 一二層間飾帶`,
    polygon: insetRing(ring, -0.25),
    base: GROUND_TOP - 0.15,
    height: 0.3,
  });
  add({
    id: "cornice",
    name: `${name} 簷口`,
    polygon: insetRing(ring, -0.6),
    base: UPPER_TOP,
    height: CORNICE_TOP - UPPER_TOP,
  });

  // 復折式馬薩頂：下段陡、上段緩
  add({
    id: "roof/mansard-lower",
    name: `${name} 馬薩頂下段`,
    polygon: insetRing(ring, -0.3),
    polygonTop: insetRing(ring, 1.3),
    base: CORNICE_TOP,
    height: MANSARD_BREAK - CORNICE_TOP,
  });
  add({
    id: "roof/mansard-upper",
    name: `${name} 馬薩頂上段`,
    polygon: insetRing(ring, 1.3),
    polygonTop: insetRing(ring, 3.2),
    base: MANSARD_BREAK,
    height: ROOF_TOP - MANSARD_BREAK,
  });

  // 老虎窗：中央一扇較大，兩側各一扇
  add({
    id: "dormer/centre",
    name: `${name} 中央老虎窗`,
    polygon: rect(front, 0, -1.2, 2.4, 1.6),
    base: CORNICE_TOP,
    height: MANSARD_BREAK - CORNICE_TOP,
  });
  add({
    id: "dormer/centre-hood",
    name: `${name} 中央老虎窗窗頂`,
    polygon: rect(front, 0, -1.2, 2.6, 1.8),
    polygonTop: rect(front, 0, -1.2, 1.0, 1.8),
    base: MANSARD_BREAK,
    height: DORMER_TOP - MANSARD_BREAK,
  });
  for (const side of [-1, 1]) {
    const along = side * facade * 0.33;
    const key = side < 0 ? "l" : "r";
    add({
      id: `dormer/${key}`,
      name: `${name} 老虎窗`,
      polygon: rect(front, along, -1.0, 1.4, 1.2),
      base: 8.0,
      height: 0.9,
    });
    add({
      id: `dormer/${key}-hood`,
      name: `${name} 老虎窗窗頂`,
      polygon: rect(front, along, -1.0, 1.6, 1.4),
      polygonTop: rect(front, along, -1.0, 0.5, 1.4),
      base: 8.9,
      height: 0.4,
    });
  }
  return parts;
}

export function claim(): Local[] {
  return outline(FUTAI_MANSION);
}
