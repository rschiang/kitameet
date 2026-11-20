/**
 * 單幅公告圖：解析 PDF、定位、分類圖層，並把座標轉為專案的局部公尺座標。
 */
import { fromTm2, type Local } from "../../src/geo/project.ts";
import type { DortsLineCode, DortsSheet } from "../../src/data/dorts-types.ts";
import { fitSheet } from "./georef.ts";
import { classify, type Category } from "./layers.ts";
import { readSheet } from "./pdf.ts";

/** 圖幅索引（ArcGIS FeatureServer）的一筆記錄。 */
export interface SheetIndex {
  name: string;
  no: string;
  lineName: string;
  lineCode: DortsLineCode;
  /** 圖框四角（TWD97 TM2）。 */
  ring: [number, number][];
}

export interface ClassifiedPath {
  category: Category;
  points: Local[];
  closed: boolean;
}

export interface SheetGeometry {
  index: SheetIndex;
  meta: DortsSheet;
  /** 方格網校正所移動的距離（公尺）；品質報告用。 */
  snapCorrection: number;
  paths: ClassifiedPath[];
}

export function loadSheet(index: SheetIndex, buffer: Buffer): SheetGeometry {
  const parsed = readSheet(buffer);
  const transform = fitSheet(parsed, index.ring);
  const toLocal = (p: [number, number]): Local => {
    const [e, n] = transform.toTwd97(p);
    return fromTm2(e, n);
  };

  const paths: ClassifiedPath[] = [];
  for (const path of parsed.paths) {
    const category = classify(path.layer);
    if (category === null) continue;
    paths.push({ category, points: path.points.map(toLocal), closed: path.closed });
  }

  return {
    index,
    meta: {
      name: index.name,
      no: index.no,
      lineName: index.lineName,
      lineCode: index.lineCode,
      ring: parsed.frame.map(toLocal),
      rotationDeg: transform.rotationDeg,
      scale: transform.scale,
      gridResidual: transform.gridResidual,
    },
    snapCorrection: transform.snapCorrection,
    paths,
  };
}
