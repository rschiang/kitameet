/**
 * 地形底圖的量體化：1/1000 地形圖的建物輪廓在 PDF 中是打散的線段，
 * 須逐幅以平面圖解析求面，再跨幅合併；道路只有邊線，串接後直接輸出。
 */
import { chainSegments, dedupeSegments } from "../../src/geo/chain.ts";
import { polygonArea, polygonCentroid } from "../../src/geo/measure.ts";
import { polygonize } from "../../src/geo/polygonize.ts";
import type { Local } from "../../src/geo/project.ts";
import type { SheetGeometry } from "./sheet.ts";

/** 節點量化格距（公尺）：地形圖的線段端點彼此相接的誤差遠小於此。 */
const SNAP = 0.08;
/** 成面的面積範圍（平方公尺）：小於下限者為符號，大於上限者為街廓外圍。 */
const AREA = { min: 12, max: 40_000 };
/** 跨幅視為同一棟建物的形心距離（公尺）與面積相對差。 */
const SAME_BUILDING = { distance: 1.0, areaRatio: 0.1 };

export interface BuiltBasemap {
  buildings: Local[][];
  roadEdges: Local[][];
  /** 各幅的成面數，供品質報告列出成面偏少的圖幅。 */
  buildingsPerSheet: { name: string; count: number }[];
}

type Segment = [Local, Local];

function segmentsOf(sheet: SheetGeometry, category: "building" | "road"): Segment[] {
  const out: Segment[] = [];
  for (const path of sheet.paths) {
    if (path.category !== category) continue;
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1];
      const b = path.points[i];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.02) out.push([a, b]);
    }
  }
  return out;
}

export function buildBasemap(sheets: SheetGeometry[]): BuiltBasemap {
  const buildings: { polygon: Local[]; centre: Local; area: number }[] = [];
  const buildingsPerSheet: { name: string; count: number }[] = [];
  // 以 2 公尺格網索引形心，跨幅合併時只比對鄰近的面
  const cell = 2;
  const index = new Map<string, number[]>();

  for (const sheet of sheets) {
    const faces = polygonize(segmentsOf(sheet, "building"), {
      snap: SNAP,
      minArea: AREA.min,
      maxArea: AREA.max,
    });
    buildingsPerSheet.push({ name: sheet.index.name, count: faces.length });

    for (const polygon of faces) {
      const centre = polygonCentroid(polygon);
      const area = Math.abs(polygonArea(polygon));
      const gx = Math.floor(centre[0] / cell);
      const gy = Math.floor(centre[1] / cell);
      let duplicate = false;
      for (let dx = -1; dx <= 1 && !duplicate; dx++) {
        for (let dy = -1; dy <= 1 && !duplicate; dy++) {
          for (const i of index.get(`${gx + dx},${gy + dy}`) ?? []) {
            const other = buildings[i];
            if (Math.hypot(centre[0] - other.centre[0], centre[1] - other.centre[1]) >= SAME_BUILDING.distance) {
              continue;
            }
            if (Math.abs(area - other.area) / Math.max(area, other.area) > SAME_BUILDING.areaRatio) continue;
            duplicate = true;
            break;
          }
        }
      }
      if (duplicate) continue;
      const key = `${gx},${gy}`;
      const list = index.get(key);
      if (list) list.push(buildings.length);
      else index.set(key, [buildings.length]);
      buildings.push({ polygon, centre, area });
    }
  }

  const roadSegments = dedupeSegments(sheets.flatMap((sheet) => segmentsOf(sheet, "road")));
  const roadEdges = chainSegments(roadSegments, { gap: 1, angleToleranceDeg: 60, minLength: 10 });

  return { buildings: buildings.map((b) => b.polygon), roadEdges, buildingsPerSheet };
}
