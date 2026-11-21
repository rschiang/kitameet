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
