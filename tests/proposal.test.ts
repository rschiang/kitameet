import { describe, expect, it } from "vitest";
import { featuresFor } from "../src/app/scenario.ts";
import { baselineById } from "../src/data/scene.ts";
import {
  EAST_THROAT,
  NEW_PLATFORM_LENGTH,
  PLATFORM_OFFSETS,
  WEST_THROAT,
  proposalB,
} from "../src/data/scenarios/proposal-b.ts";
import { decompose, polygonAxis } from "../src/geo/measure.ts";
import { PLATFORM_WIDTH } from "../src/data/schema.ts";

const features = featuresFor("proposal-b");
const byId = new Map(features.map((f) => [f.id, f]));

/** 兩組點之間的最短距離（公尺）。 */
function minDistance(a: [number, number][], b: [number, number][]): number {
  let min = Infinity;
  for (const p of a) {
    for (const q of b) min = Math.min(min, Math.hypot(p[0] - q[0], p[1] - q[1]));
  }
  return min;
}

describe("方案 B 幾何", () => {
  it("兩座新月台為 410 公尺、寬 12 公尺的島式月台", () => {
    for (const name of Object.keys(PLATFORM_OFFSETS)) {
      const platform = byId.get(`proposal-b/platform/${name}`);
      expect(platform, name).toBeDefined();
      const axis = polygonAxis(platform!.geometry.polygon!);
      expect(axis.length).toBeCloseTo(NEW_PLATFORM_LENGTH, 0);
      expect(axis.width).toBeCloseTo(PLATFORM_WIDTH, 1);
      expect(platform!.level).toBe("B2");
      expect(platform!.status).toBe("added");
    }
  });

  it("新月台落在 K 區地下街的帶狀範圍內（兩端容許 5 公尺誤差）", () => {
    const k = baselineById("way/450732441")!.geometry.polygon!;
    const ys = k.map((p) => p[1]);
    const north = Math.max(...ys) + 5;
    const south = Math.min(...ys) - 5;
    for (const name of Object.keys(PLATFORM_OFFSETS)) {
      const polygon = byId.get(`proposal-b/platform/${name}`)!.geometry.polygon!;
      for (const [, y] of polygon) {
        expect(y, `${name} 超出 K 區帶狀範圍`).toBeLessThan(north);
        expect(y, `${name} 超出 K 區帶狀範圍`).toBeGreaterThan(south);
      }
    }
  });

  it("新月台與捷運板南線月台淨距不小於 20 公尺", () => {
    const bannan = baselineById("way/741259904")!.geometry.polygon!;
    for (const name of Object.keys(PLATFORM_OFFSETS)) {
      const polygon = byId.get(`proposal-b/platform/${name}`)!.geometry.polygon!;
      expect(minDistance(polygon, bannan), name).toBeGreaterThan(20);
    }
  });

  it("新建股道兩端對齊既有高鐵路廊的中心線", () => {
    const bearing = polygonAxis(baselineById("way/584167409")!.geometry.polygon!).bearing;
    for (const name of Object.keys(PLATFORM_OFFSETS)) {
      for (const side of ["北", "南"]) {
        const track = byId.get(`proposal-b/track/${name}-${side}`);
        expect(track, `${name}${side}`).toBeDefined();
        const line = track!.geometry.polyline!;
        // 兩端的橫向位置須落在既有喉管的路廊線上；縱向可超出喉管
        const west = decompose(WEST_THROAT, bearing, line[0]).lateral;
        const east = decompose(EAST_THROAT, bearing, line[line.length - 1]).lateral;
        expect(Math.abs(west), `${name}${side} 西端`).toBeLessThan(3);
        expect(Math.abs(east), `${name}${side} 東端`).toBeLessThan(3);
      }
    }
  });

  it("K 區地下街標為拆除、第一二月台標為歸還臺鐵", () => {
    for (const id of proposalB.removed) {
      expect(byId.get(id)?.status, id).toBe("removed");
    }
    expect(byId.get("way/584167409")?.status).toBe("repurposed");
    expect(byId.get("way/584167411")?.status).toBe("repurposed");
  });

  it("現況模式不含任何新建量體", () => {
    const statusQuo = featuresFor("status-quo");
    expect(statusQuo.some((f) => f.id.startsWith("proposal-b/"))).toBe(false);
    expect(statusQuo.every((f) => f.status !== "added")).toBe(true);
  });
});
