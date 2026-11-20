/** `scripts/fetch-dorts.ts` 的產出格式；腳本與網站共用此定義。 */
import type { Local } from "../geo/project.ts";

/** 公告圖的路線代號；松山線的圖幅名為 `SS*`，代號卻是 `G`。 */
export type DortsLineCode = "N" | "P" | "T" | "H" | "G";

export interface DortsSheet {
  /** 圖幅名，即 PDF 檔名，例如 `SA01RWN010A`。 */
  name: string;
  /** 圖號，例如 `CN10`。 */
  no: string;
  lineName: string;
  lineCode: DortsLineCode;
  /** 圖框四角（局部公尺座標）。 */
  ring: Local[];
  /** 圖面相對 TWD97 座標軸的旋轉角（度）。 */
  rotationDeg: number;
  /** 公尺／pt。 */
  scale: number;
  /** 方格網落在 50 公尺整數倍上的最大偏差（公尺）。 */
  gridResidual: number;
}

export type DortsTunnel =
  | { id: string; lineCode: DortsLineCode; kind: "bore"; line: Local[]; radius: number }
  | { id: string; lineCode: DortsLineCode; kind: "box"; polygon: Local[]; width: number };

export interface DortsLine {
  id: string;
  lineCode: DortsLineCode;
  line: Local[];
}

export interface DortsStructures {
  generatedAt: string;
  originLatLon: { lat: number; lon: number };
  sheets: DortsSheet[];
  tunnels: DortsTunnel[];
  tracks: DortsLine[];
  restrictionLines: DortsLine[];
}

export interface DortsBasemap {
  generatedAt: string;
  originLatLon: { lat: number; lon: number };
  buildings: { id: string; polygon: Local[] }[];
  roadEdges: { id: string; line: Local[] }[];
}
