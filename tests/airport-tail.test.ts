/**
 * 機場捷運 A1 直通化：兩條正線穿越月台後東行，以尾軌止於中山北路一段西側。
 * 尾軌全段維持 B3 軌道面高程（坡度 0），自淡水信義線軌道面上方通過，
 * 末端須留有足夠長度的平直段。兩個方案的尾軌相同。
 */
import { describe, expect, it } from "vitest";
import { featuresFor } from "../src/app/scenario.ts";
import { baselineById } from "../src/data/scene.ts";
import { platform1Axis } from "../src/data/scenarios/shared.ts";
import { sideOfPolyline } from "../src/geo/clip.ts";
import { decompose, nearestOnPolyline } from "../src/geo/measure.ts";
import type { Local } from "../src/geo/project.ts";

/** 尾軌起點所銜接的既有 A1 正線。 */
const A1_TRACKS: Record<string, string> = { 北: "way/1558102739", 南: "way/1558102738" };
/** 尾軌東端的沿主軸位置（公尺）：中山北路一段西側車道。 */
const TAIL_END = 309;
/** A1 車站 B3 軌道面高程（公尺，EL）。 */
const RAIL = -16.775;
/** 淡水信義線正線：尾軌自其上方通過。 */
const TAMSUI_TRACKS = ["dorts/T/track/3", "dorts/T/track/5"];

/** 折線的最小曲率半徑（公尺）；直線段略過。 */
function minRadius(points: Local[]): number {
  let min = Infinity;
  for (let i = 2; i < points.length - 2; i++) {
    const [a, b, c] = [points[i - 2], points[i], points[i + 2]];
    const ab = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const bc = Math.hypot(b[0] - c[0], b[1] - c[1]);
    const ca = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
    if (area < 1e-6) continue;
    min = Math.min(min, (ab * bc * ca) / (4 * area));
  }
  return min;
}

/** 兩組折線之間的最短距離（公尺），量到線段而非頂點。 */
function segmentDistance(a: Local[], b: Local[]): number {
  let min = Infinity;
  for (const p of a) min = Math.min(min, nearestOnPolyline(p, b).distance);
  for (const q of b) min = Math.min(min, nearestOnPolyline(q, a).distance);
  return min;
}

describe.each(["proposal-b", "proposal-c"] as const)("%s 的機場捷運尾軌", (scenario) => {
  const features = featuresFor(scenario);
  const byId = new Map(features.map((f) => [f.id, f]));
  const axis = platform1Axis();
  const along = (p: Local): number => decompose(axis.center, axis.bearing, p).along;
  const tailOf = (side: string): Local[] => {
    const tail = byId.get(`${scenario}/a1/tail/${side}`);
    expect(tail, side).toBeDefined();
    return tail!.geometry.polyline as Local[];
  };

  it("兩條尾軌皆為新建的機場捷運股道，全段坡度 0", () => {
    for (const side of ["北", "南"]) {
      const tail = byId.get(`${scenario}/a1/tail/${side}`)!;
      expect(tail.kind, side).toBe("track-metro");
      expect(tail.line, side).toBe("a");
      expect(tail.status, side).toBe("added");
      expect(tail.level, side).toBe("B3");
      expect(tail.base, side).toBeCloseTo(RAIL, 6);
      expect(tail.baseEnd, `${side} 坡度 0`).toBeUndefined();
    }
  });

  it("尾軌自既有正線東端接出，止於中山北路一段", () => {
    for (const side of ["北", "南"]) {
      const tail = tailOf(side);
      const existing = baselineById(A1_TRACKS[side])!.geometry.polyline!;
      const east = existing.reduce((a, b) => (along(a) > along(b) ? a : b));
      expect(Math.hypot(tail[0][0] - east[0], tail[0][1] - east[1]), `${side} 起點`).toBeLessThan(
        0.05,
      );
      expect(Math.abs(along(tail[tail.length - 1]) - TAIL_END), `${side} 東端`).toBeLessThan(1.0);
    }
  });

  it("尾軌末端的平直段長於 150 公尺", () => {
    for (const side of ["北", "南"]) {
      const tail = tailOf(side);
      const [a, b] = [tail[tail.length - 2], tail[tail.length - 1]];
      expect(Math.hypot(b[0] - a[0], b[1] - a[1]), `${side} 末端直線`).toBeGreaterThan(150);
    }
  });

  it("尾軌最小曲率半徑不低於 195 公尺", () => {
    for (const side of ["北", "南"]) {
      expect(minRadius(tailOf(side)), side).toBeGreaterThan(195);
    }
  });

  it("尾軌與臺北車站地下量體的平面淨距大於 5 公尺", () => {
    const box = baselineById("station/box")!.geometry.polygon!;
    for (const side of ["北", "南"]) {
      expect(segmentDistance(tailOf(side), box), side).toBeGreaterThan(5);
    }
  });

  it("尾軌維持 A1 車站 B3 軌道面，平面上橫越淡水信義線正線", () => {
    for (const side of ["北", "南"]) {
      const tail = byId.get(`${scenario}/a1/tail/${side}`)!;
      const line = tail.geometry.polyline as Local[];
      for (const id of TAMSUI_TRACKS) {
        const existing = baselineById(id)!;
        const sides = (existing.geometry.polyline as Local[]).map((p) => sideOfPolyline(line, p));
        expect(Math.max(...sides), `${side} × ${id} 未橫越`).toBeGreaterThan(0);
        expect(Math.min(...sides), `${side} × ${id} 未橫越`).toBeLessThan(0);
      }
      expect(tail.base, side).toBeCloseTo(RAIL, 6);
    }
  });

  it("兩條尾軌之間有一條渡線", () => {
    const link = byId.get(`${scenario}/a1/link/X1`);
    expect(link).toBeDefined();
    expect(link!.kind).toBe("track-metro");
    expect(link!.status).toBe("added");
    const [a, b] = link!.geometry.polyline as Local[];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    expect(length).toBeGreaterThan(45);
    expect(length).toBeLessThan(60);
  });
});
