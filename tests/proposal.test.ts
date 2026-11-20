import { describe, expect, it } from "vitest";
import { featuresFor } from "../src/app/scenario.ts";
import { baselineById } from "../src/data/scene.ts";
import {
  NEW_PLATFORM_LENGTH,
  PLATFORM_OFFSETS,
  REBUILD_ZONE,
  proposalB,
} from "../src/data/scenarios/proposal-b.ts";
import { polygonAxis } from "../src/geo/measure.ts";
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

  it("新建股道西至延平北路、東至中山北路", () => {
    for (const name of Object.keys(PLATFORM_OFFSETS)) {
      for (const side of ["北", "南"]) {
        const track = byId.get(`proposal-b/track/${name}-${side}`);
        expect(track, `${name}${side}`).toBeDefined();
        const line = track!.geometry.polyline!;
        expect(Math.abs(line[0][0] - REBUILD_ZONE.westX), `${name}${side} 西端`).toBeLessThan(1.5);
        expect(
          Math.abs(line[line.length - 1][0] - REBUILD_ZONE.eastX),
          `${name}${side} 東端`,
        ).toBeLessThan(1.5);
      }
    }
  });

  it("改建區間內的既有高鐵股道標為改建、區間外保留", () => {
    for (const { id, keep, limitX } of proposalB.rebuilt) {
      const rebuilt = byId.get(`${id}/rebuilt`);
      expect(rebuilt, id).toBeDefined();
      expect(rebuilt!.status, id).toBe("removed");
      const kept = byId.get(id);
      expect(kept, id).toBeDefined();
      for (const [x] of kept!.geometry.polyline!) {
        if (keep === "west") expect(x, `${id} 保留段`).toBeLessThanOrEqual(limitX + 1e-6);
        else expect(x, `${id} 保留段`).toBeGreaterThanOrEqual(limitX - 1e-6);
      }
    }
  });

  it("站內 5 條高鐵股道改作臺鐵使用", () => {
    for (const id of ["way/593871124", "way/593871149", "way/615600478", "way/615600479", "way/615600481"]) {
      expect(byId.get(id)?.status, id).toBe("repurposed");
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
