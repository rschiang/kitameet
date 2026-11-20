import { describe, expect, it } from "vitest";
import { buildBaseline, baselineById } from "../src/data/scene.ts";
import { LEVELS, PLATFORM_RISE } from "../src/data/schema.ts";

const features = buildBaseline();

/** 多邊形最長對角距離，用於驗證月台長度。 */
function longestSpan(points: [number, number][]): number {
  let max = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      max = Math.max(max, Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]));
    }
  }
  return max;
}

describe("現況場景", () => {
  it("四座臺鐵、高鐵月台位於 B2 且長約 331 公尺", () => {
    const ids = ["way/584167409", "way/584167411", "way/584167413", "way/584167415"];
    for (const id of ids) {
      const f = baselineById(id);
      expect(f, id).toBeDefined();
      expect(f!.level).toBe("B2");
      expect(f!.layer).toBe("platform");
      expect(longestSpan(f!.geometry.polygon!)).toBeGreaterThan(325);
      expect(longestSpan(f!.geometry.polygon!)).toBeLessThan(336);
      // 月台面與 B2 樓板齊平
      expect(f!.base! + f!.height!).toBeCloseTo(LEVELS.B2.floor, 6);
      expect(f!.height).toBeCloseTo(PLATFORM_RISE, 6);
    }
  });

  it("站體採文獻高度 48 公尺而非 OSM 的 30 公尺", () => {
    const station = baselineById("way/23641610");
    expect(station?.height).toBe(48);
    expect(station?.confidence).toBe("sourced");
    expect(station?.sourceNote).toContain("維基百科");
  });

  it("捷運月台依文獻分別位於 B3 與 B4", () => {
    expect(baselineById("way/741259904")?.level).toBe("B3");
    expect(baselineById("way/741259905")?.level).toBe("B4");
  });

  it("K 區地下街改列 B1 並標為推估", () => {
    const k = baselineById("way/450732441");
    expect(k?.level).toBe("B1");
    expect(k?.layer).toBe("mall");
    expect(k?.confidence).toBe("estimated");
  });

  it("每個量體都有幾何、圖層與可信度", () => {
    expect(features.length).toBeGreaterThan(500);
    for (const f of features) {
      const size =
        (f.geometry.polygon?.length ?? 0) + (f.geometry.polyline?.length ?? 0);
      expect(size, f.id).toBeGreaterThan(1);
      expect(f.confidence, f.id).toBeDefined();
      expect(Number.isFinite(f.height!), f.id).toBe(true);
      expect(Number.isFinite(f.base!), f.id).toBe(true);
    }
  });

  it("站體產生地下量體與 B1–B4 樓板", () => {
    expect(baselineById("station/box")?.base).toBeLessThan(-30);
    for (const level of ["B1", "B2", "B3", "B4"]) {
      expect(baselineById(`station/slab/${level}`)?.level).toBe(level);
    }
  });
});
