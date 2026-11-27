/**
 * 臺鐵喉道：兩方案把既有第一、二月台包夾的四股道歸還臺鐵後，
 * 這四股道必須經重建的喉道同時接上西側東正線與東側西正線，且全程不與新建高鐵股道平面交叉。
 */
import { describe, expect, it } from "vitest";
import { featuresFor } from "../src/app/scenario.ts";
import { baselineById } from "../src/data/scene.ts";
import type { Feature } from "../src/data/schema.ts";
import { platform1Axis } from "../src/data/scenarios/shared.ts";
import { decompose, nearestOnPolyline } from "../src/geo/measure.ts";
import type { Local } from "../src/geo/project.ts";

/** 第一、二月台包夾的四股道。 */
const STATION_TRACKS = [
  "way/615600479",
  "way/593871149",
  "way/615600481",
  "way/593871124",
];
/** 西側東正線與東側西正線：列車必須能自站內股道抵達兩者。 */
const WEST_MAIN = "way/615600483";
const EAST_MAIN = "way/194118023";
/** 股道端點視為相連的距離（公尺）。 */
const JOIN = 0.05;
/** 臺鐵股道與新建高鐵股道的最小水平淨距（公尺）。 */
const MIN_GAP = 4.0;

/** 臺鐵可用的股道：未拆除、有中心線，且為臺鐵股道或改作臺鐵的既有高鐵股道。 */
function traUsable(features: Feature[]): Feature[] {
  return features.filter(
    (f) =>
      f.status !== "removed" &&
      f.geometry.polyline !== undefined &&
      (f.kind === "track-tra" || (f.kind === "track-hsr" && f.status === "repurposed")),
  );
}

/** 兩條線段的最短距離（公尺）。 */
function segmentDistance(a: Local[], b: Local[]): number {
  let min = Infinity;
  for (const p of a) min = Math.min(min, nearestOnPolyline(p, b).distance);
  for (const q of b) min = Math.min(min, nearestOnPolyline(q, a).distance);
  return min;
}

/** 自起點沿「端點落在對方中心線上」的關係走訪，回傳可達的股道 id。 */
function reachable(tracks: Feature[], from: string): Set<string> {
  const lines = new Map(tracks.map((f) => [f.id, f.geometry.polyline as Local[]]));
  const touches = (a: Local[], b: Local[]): boolean =>
    [a[0], a[a.length - 1]].some((p) => nearestOnPolyline(p, b).distance <= JOIN) ||
    [b[0], b[b.length - 1]].some((p) => nearestOnPolyline(p, a).distance <= JOIN);

  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const current = lines.get(queue.shift() as string);
    if (!current) continue;
    for (const [id, line] of lines) {
      if (seen.has(id) || !touches(current, line)) continue;
      seen.add(id);
      queue.push(id);
    }
  }
  return seen;
}

describe.each(["proposal-b", "proposal-c"] as const)("%s 的臺鐵喉道", (scenario) => {
  const features = featuresFor(scenario);
  const byId = new Map(features.map((f) => [f.id, f]));
  const tracks = traUsable(features);

  it("五條聯絡線與渡線皆已新建", () => {
    for (const key of ["W1", "W2", "E1", "E2", "E3"]) {
      const link = byId.get(`${scenario}/tra-link/${key}`);
      expect(link, key).toBeDefined();
      expect(link!.kind, key).toBe("track-tra");
      expect(link!.status, key).toBe("added");
      const [a, b] = link!.geometry.polyline as Local[];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      expect(length, `${key} 長度`).toBeGreaterThan(30);
      expect(length, `${key} 長度`).toBeLessThan(60);
    }
  });

  it("站內四股道皆可經喉道抵達西側東正線與東側西正線", () => {
    for (const id of STATION_TRACKS) {
      const found = reachable(tracks, id);
      expect(found.has(WEST_MAIN), `${id} 無法抵達西側東正線`).toBe(true);
      expect(found.has(EAST_MAIN), `${id} 無法抵達東側西正線`).toBe(true);
    }
  });

  it("臺鐵股道與新建高鐵股道不平面交叉", () => {
    const hsr = features.filter((f) => f.kind === "track-hsr" && f.status === "added");
    expect(hsr).toHaveLength(scenario === "proposal-b" ? 6 : 4);
    for (const track of tracks) {
      for (const f of hsr) {
        expect(
          segmentDistance(track.geometry.polyline as Local[], f.geometry.polyline as Local[]),
          `${track.id} × ${f.id}`,
        ).toBeGreaterThan(MIN_GAP);
      }
    }
  });

  it("東側既有高鐵股道的喉道外區段拆除，月台側改作臺鐵", () => {
    for (const id of ["way/381111230", "way/593866771"]) {
      expect(byId.get(`${id}/rebuilt`)?.status, id).toBe("removed");
      expect(byId.get(`${id}/tra`)?.status, id).toBe("repurposed");
    }

    const axis = platform1Axis();
    const tra = byId.get("way/13991375/tra");
    expect(tra?.status).toBe("repurposed");
    for (const p of tra!.geometry.polyline as Local[]) {
      const { along } = decompose(axis.center, axis.bearing, p);
      expect(along, "西側北線改作區間").toBeGreaterThanOrEqual(-322.5);
      expect(along, "西側北線改作區間").toBeLessThanOrEqual(-260.5);
    }
  });

  it("現況模式沒有喉道聯絡線", () => {
    expect(featuresFor("status-quo").some((f) => f.id.includes("/tra-link/"))).toBe(false);
    expect(baselineById("way/13991375/tra")).toBeUndefined();
  });
});
