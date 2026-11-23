/** `scripts/fetch-osm.ts` 的產出格式；腳本與網站共用此定義。 */
import type { Local } from "../geo/project.ts";

export type OsmKind =
  | "platform"
  | "track-hsr"
  | "track-tra"
  | "track-metro"
  | "underground-mall"
  | "station"
  | "building"
  | "elevated-road"
  | "road"
  | "footway"
  | "water"
  | "sand"
  | "green"
  | "plaza"
  | "other";

export interface OsmFeature {
  id: string;
  source: "osm";
  kind: OsmKind;
  name?: string;
  level?: number;
  tags: Record<string, string>;
  polygon?: Local[];
  polyline?: Local[];
}

export interface OsmDataset {
  generatedAt: string;
  queryBbox: { south: number; west: number; north: number; east: number };
  overpassTimestamp: string | null;
  originLatLon: { lat: number; lon: number };
  features: OsmFeature[];
}

/** `indoor.json` 的圖徵種類：站內動線的 way 與 node。 */
export type IndoorKind = "corridor" | "steps" | "elevator" | "entrance" | "room" | "parking";

export interface IndoorFeature {
  /** `way/123` 或 `node/456`。 */
  id: string;
  kind: IndoorKind;
  tags: Record<string, string>;
  /** 通道與階梯的中心線。 */
  polyline?: Local[];
  /** 付費區與停車場的輪廓，不含閉合頂點。 */
  polygon?: Local[];
  /** 電梯與出入口的點位。 */
  point?: Local;
}

export interface IndoorDataset extends Omit<OsmDataset, "features"> {
  features: IndoorFeature[];
}
