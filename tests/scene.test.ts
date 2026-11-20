import { describe, expect, it } from "vitest";
import { buildBaseline, baselineById } from "../src/data/scene.ts";
import { METRO_LINES, levelOf, railLevelOf, type MetroLineId } from "../src/data/levels.ts";
import { PLATFORM_RISE } from "../src/data/schema.ts";

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
      // 月台自 B2 樓板面長高 1.1 公尺
      expect(f!.structure, id).toBe("tra-hsr-station");
      expect(f!.base!).toBeCloseTo(levelOf("tra-hsr-station", "B2").floor, 6);
      expect(f!.height).toBeCloseTo(PLATFORM_RISE, 6);
    }
  });

  it("站體地上量體為細部模型，最高點合於文獻的 48 公尺", () => {
    const parts = features.filter((f) => f.id.startsWith("landmark/taipei-station/"));
    expect(parts.length).toBeGreaterThan(20);
    const top = Math.max(...parts.map((f) => (f.base ?? 0) + (f.height ?? 0)));
    expect(top).toBeCloseTo(48, 6);
    expect(parts.every((f) => f.layer === "landmark")).toBe(true);
    expect(parts[0].sourceNote).toContain("維基百科");
    // OSM 的 height=30 不再直接成為量體
    expect(baselineById("way/23641610")).toBeUndefined();
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
        (f.geometry.polygon?.length ?? 0) +
        (f.geometry.polyline?.length ?? 0) +
        (f.geometry.tube?.length ?? 0);
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

  it("臺鐵高鐵股道一律位於站體 B2 月台層，不隨 OSM 的 layer 散落", () => {
    const rail = features.filter((f) => f.kind === "track-tra" || f.kind === "track-hsr");
    expect(rail.length).toBeGreaterThan(30);
    const ramp = ["way/542501098", "way/542501099"];
    for (const track of rail) {
      expect(track.line, track.id).toBe(track.kind === "track-hsr" ? "hsr" : "tra");
      if (ramp.includes(track.id)) continue;
      expect(track.base!, track.id).toBeCloseTo(railLevelOf("tra-hsr-station", "B2"), 6);
      expect(track.baseEnd, track.id).toBeUndefined();
    }
  });

  it("華山引道自 B2 月台層爬升至地面", () => {
    for (const id of ["way/542501098", "way/542501099"]) {
      const feature = baselineById(id);
      expect(feature, id).toBeDefined();
      expect(feature!.base, id).toBeCloseTo(-1.0, 6);
      expect(feature!.baseEnd!, id).toBeCloseTo(railLevelOf("tra-hsr-station", "B2"), 6);
    }
  });

  it("捷運股道的深度由所屬路線決定，疊式段下層另行覆寫", () => {
    const lower = new Set(["way/194585049", "way/194585053", "way/194585061"]);
    const metro = features.filter((f) => f.kind === "track-metro" && f.line !== undefined);
    expect(metro.length).toBeGreaterThan(20);
    for (const track of metro) {
      const rail = METRO_LINES[track.line as MetroLineId].rail;
      if (lower.has(track.id)) expect(track.base!, track.id).toBeCloseTo(rail - 7.0, 6);
      else expect(track.base!, track.id).toBeCloseTo(rail, 6);
    }
  });

  it("台北雙星依新聞稿高度，且高於新光人壽", () => {
    const c1 = baselineById("way/1502280687");
    const d1 = baselineById("way/1502280746");
    expect(c1?.height).toBe(280);
    expect(d1?.height).toBe(360);
    expect(c1?.layer).toBe("landmark");
    expect(d1?.layer).toBe("landmark");
  });

  it("雨棚與通風井不以樓層數推估為實心方塊", () => {
    const canopy = baselineById("way/197917727");
    expect(canopy, "way/197917727").toBeDefined();
    // 架高的薄頂板，不是自地面長起的量體
    expect(canopy!.base!).toBeGreaterThan(3);
    expect(canopy!.height!).toBeLessThan(1);
  });

  it("市民大道高架有梁深與橋墩，匝道自橋面斜降至地面", () => {
    const elevated = features.filter((f) => f.kind === "elevated-road");
    const decks = elevated.filter((f) => !f.id.includes("/pier/"));
    const piers = elevated.filter((f) => f.id.includes("/pier/"));
    expect(piers.length).toBeGreaterThan(20);
    for (const pier of piers) {
      expect(pier.base, pier.id).toBe(0);
      expect(pier.base! + pier.height!, pier.id).toBeCloseTo(8.0 - 1.8, 6);
    }
    // 橋面頂維持 8.0 公尺
    for (const deck of decks) {
      const top = Math.max(deck.base!, deck.baseEnd ?? deck.base!) + deck.height!;
      expect(top, deck.id).toBeLessThanOrEqual(8.0 + 1e-6);
    }
    const ramp = baselineById("way/581377324");
    expect(ramp?.base).toBeCloseTo(0.1, 6);
    expect(ramp?.baseEnd).toBeCloseTo(8.0 - 1.0, 6);
  });

  it("華山車站舊站房與臺北轉運站列為一般建物，不是車站量體", () => {
    const huashan = baselineById("way/448227619");
    expect(huashan?.kind).toBe("building");
    expect(huashan?.layer).toBe("building");
    // 臺北轉運站落在公告圖範圍內，輪廓改採公告圖建物面並承接此處推估的高度
    expect(baselineById("way/605982576")).toBeUndefined();
    const inherited = features.filter((f) => f.sourceNote?.includes("way/605982576"));
    expect(inherited.length).toBeGreaterThan(0);
    for (const face of inherited) expect(face.layer, face.id).toBe("building");

    const boxes = features.filter((f) => f.layer === "station-box").map((f) => f.id);
    expect(boxes).not.toContain("way/448227619");
    expect(boxes).not.toContain("way/605982576");
  });
});
