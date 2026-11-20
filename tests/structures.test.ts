import { describe, expect, it } from "vitest";
import { baselineById, buildBaseline } from "../src/data/scene.ts";
import { STRUCTURES, levelOf, railLevelOf } from "../src/data/levels.ts";
import { LEVELS, type LevelId } from "../src/data/schema.ts";
import { DEPTH_EXAGGERATION } from "../src/render/depth.ts";
import { buildFeatureMesh } from "../src/render/builders.ts";

const features = buildBaseline();
const DEPTHS: LevelId[] = ["B1", "B2", "B3", "B4"];

describe("構造物樓層表", () => {
  it("每個構造物的樓層由淺至深遞減且層層相疊", () => {
    for (const [id, info] of Object.entries(STRUCTURES)) {
      const present = DEPTHS.filter((level) => info.levels[level] !== undefined);
      expect(present.length, id).toBeGreaterThan(0);
      for (let i = 1; i < present.length; i++) {
        const upper = info.levels[present[i - 1]]!;
        const lower = info.levels[present[i]]!;
        expect(upper.floor, `${id} ${present[i - 1]}`).toBeGreaterThan(lower.floor);
        // 上層樓板不得低於下層的淨高頂面
        expect(upper.floor, `${id} ${present[i - 1]} 層高`).toBeGreaterThanOrEqual(
          lower.floor + lower.height - 0.01,
        );
      }
      const deepest = info.levels[present[present.length - 1]]!;
      expect(deepest.floor, `${id} 結構底`).toBeGreaterThanOrEqual(info.bottom);
    }
  });

  it("未指定構造物或缺少該層時回退預設樓層表", () => {
    expect(levelOf(undefined, "B2").floor).toBe(LEVELS.B2.floor);
    expect(() => levelOf("mall-z", "B3")).not.toThrow();
    expect(levelOf("mall-z", "B3").floor).toBe(LEVELS.B3.floor);
  });

  it("同一樓層標籤在不同構造物有不同深度", () => {
    const station = levelOf("tra-hsr-station", "B2").floor;
    const metro = levelOf("metro-station", "B2").floor;
    expect(station).toBe(-14.5);
    expect(metro).toBe(-11.0);
    expect(Math.abs(station - metro)).toBeGreaterThan(3);
  });
});

describe("分層地下構造", () => {
  it("站體 B1 有 5 條南北通道與 2 條迴廊，通道南端穿出站體", () => {
    const passages = features.filter((f) => f.id.startsWith("station/passage/"));
    const corridors = features.filter((f) => f.id.startsWith("station/corridor/"));
    expect(passages).toHaveLength(5);
    expect(corridors).toHaveLength(2);

    // 站體平面取自 OSM 輪廓，地上量體改為細部模型後由樓板沿用
    const outline = baselineById("station/slab/B1")!.geometry.polygon!;
    const stationSouth = Math.min(...outline.map(([, y]) => y));
    for (const passage of passages) {
      expect(passage.level, passage.id).toBe("B1");
      const south = Math.min(...passage.geometry.polygon!.map(([, y]) => y));
      // 通道垂直於傾斜 15.8 度的主軸，南端的 y 超出量隨位置而異，最小約 37 公尺
      expect(stationSouth - south, passage.id).toBeGreaterThan(35);
    }
  });

  it("捷運站四層皆有量體，兩線月台深度相差超過 5 公尺", () => {
    for (const level of DEPTHS) {
      const atLevel = features.filter(
        (f) => f.structure === "metro-station" && f.level === level,
      );
      expect(atLevel.length, level).toBeGreaterThan(0);
    }

    const bannan = baselineById("way/741259904")!;
    const tamsui = baselineById("way/741259905")!;
    expect(bannan.base).toBeCloseTo(railLevelOf("metro-station", "B3"), 6);
    expect(tamsui.base).toBeCloseTo(railLevelOf("metro-station", "B4"), 6);
    expect(bannan.base! - tamsui.base!).toBeGreaterThan(5);
  });

  it("捷運與機場捷運的單一 OSM 輪廓已排除", () => {
    expect(baselineById("way/366766273")).toBeUndefined();
    expect(baselineById("way/1226069619")).toBeUndefined();
  });

  it("A1 車站結構底為 −27.1 公尺，月台與股道改用 OSM 圖徵呈現於 B3", () => {
    expect(baselineById("a1/box")?.base).toBe(-27.1);
    // 合成的月台與股道已刪除，改以 OSM 原圖徵呈現
    expect(baselineById("a1/platform")).toBeUndefined();
    for (const id of ["way/871105041", "way/871105042"]) {
      const platform = baselineById(id);
      expect(platform, id).toBeDefined();
      expect(platform!.level, id).toBe("B3");
      expect(platform!.structure, id).toBe("airport-mrt-a1");
      expect(platform!.base, id).toBeCloseTo(railLevelOf("airport-mrt-a1", "B3"), 6);
    }
    const tracks = features.filter(
      (f) => f.structure === "airport-mrt-a1" && f.kind === "track-metro",
    );
    expect(tracks.length).toBeGreaterThanOrEqual(4);
    for (const f of tracks) expect(f.level, f.id).toBe("B3");
  });
});

describe("深度放大", () => {
  const boundsY = (id: string): { min: number; max: number } => {
    const feature = baselineById(id)!;
    const mesh = buildFeatureMesh(feature)!;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    return { min: box.min.y, max: box.max.y };
  };

  it("地下量體的高程放大 1.2 倍，地面建物不變", () => {
    const core = baselineById("metro/core/1")!;
    const bounds = boundsY(core.id);
    expect(bounds.min).toBeCloseTo(core.base! * DEPTH_EXAGGERATION, 2);
    expect(bounds.max).toBeCloseTo((core.base! + core.height!) * DEPTH_EXAGGERATION, 2);

    // 地面建物不受放大影響；輪廓可能來自 OSM 或公告圖地形底圖，故不綁定單一 id
    const ground = features.find(
      (f) => (f.kind === "building" || f.kind === "landmark") && f.base === 0 && f.geometry.polygon,
    )!;
    expect(boundsY(ground.id).min).toBeCloseTo(0, 6);
  });
});
