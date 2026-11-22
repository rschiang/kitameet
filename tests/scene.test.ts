import { describe, expect, it } from "vitest";
import { buildBaseline, baselineById } from "../src/data/scene.ts";
import {
  METRO_LINES,
  levelOf,
  railLevelOf,
  type MetroLineId,
  type StructureId,
} from "../src/data/levels.ts";
import {
  TIER_RISE,
  deckCentrelines,
  deckProfiles,
} from "../src/data/structures/elevated.ts";
import { STACKED_TRACK_IDS } from "../src/data/structures/stacked-station.ts";
import { nearestOnPolyline } from "../src/geo/measure.ts";
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
    const lower = ["way/194585053", "way/194585061"];
    const metro = features.filter((f) => f.kind === "track-metro" && f.line !== undefined);
    expect(metro.length).toBeGreaterThan(20);
    for (const track of metro) {
      // 疊式車站的正線另有縱斷面，見下一則測試
      if (STACKED_TRACK_IDS.has(track.id.split("#")[0])) continue;
      const rail = METRO_LINES[track.line as MetroLineId].rail;
      if (lower.some((id) => track.id.startsWith(id))) {
        expect(track.base!, track.id).toBeCloseTo(rail - 7.0, 6);
        continue;
      }
      expect(track.base!, track.id).toBeCloseTo(rail, 6);
    }
  });

  it("西門站與中正紀念堂站的正線分列上下兩層，月台與軌道等高", () => {
    const cases = [
      { structure: "metro-station-ximen" as StructureId, lines: ["bl", "g"] },
      { structure: "metro-station-cks" as StructureId, lines: ["r", "g"] },
    ];
    for (const { structure, lines } of cases) {
      const tracks = features.filter((f) => f.kind === "track-metro" && f.structure === structure);
      // 兩條路線各一組上下行正線；站區跨 OSM way 交界處會再切段，故以路線與深度的組合比對
      const pairs = new Set(tracks.map((f) => `${f.line}@${f.base}`));
      expect(pairs, structure).toEqual(
        new Set(lines.flatMap((line) => [`${line}@-14.5`, `${line}@-22`])),
      );
      for (const track of tracks) {
        expect(track.base!, track.id).toBeCloseTo(railLevelOf(structure, track.level), 6);
      }
      const platforms = features.filter((f) => f.kind === "platform" && f.structure === structure);
      expect(platforms.length, structure).toBe(2);
      for (const platform of platforms) {
        expect(platform.base!, platform.id).toBeCloseTo(railLevelOf(structure, platform.level), 6);
        expect(platform.height!, platform.id).toBeCloseTo(PLATFORM_RISE, 6);
      }
    }
  });

  it("疊式站區外的正線以不陡於 3.5% 的坡度接回本線軌道面", () => {
    const parts = features.filter((f) => f.id.startsWith("way/194585058#"));
    const slope = parts.filter((f) => f.baseEnd !== undefined);
    expect(slope.length).toBe(1);
    const [from, to] = [slope[0].base!, slope[0].baseEnd!];
    expect(new Set([from, to])).toEqual(new Set([-14.5, -22.0]));
    const line = slope[0].geometry.polyline!;
    const length = line.reduce(
      (sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1])),
      0,
    );
    expect(Math.abs(to - from) / length).toBeLessThanOrEqual(0.035 + 1e-6);
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

  it("橋墩落在自己的橋面之下，柱頂貼合橋面底面", () => {
    const centrelines = new Map(deckCentrelines().map((deck) => [deck.id, deck.points]));
    const profiles = deckProfiles();
    const piers = features.filter((f) => /^way\/\d+\/pier\/\d+(#\d+)?$/.test(f.id));
    expect(piers.length).toBeGreaterThan(100);
    for (const pier of piers) {
      const deckId = pier.id.replace(/\/pier\/\d+(#\d+)?$/, "");
      const points = centrelines.get(deckId);
      expect(points, pier.id).toBeDefined();
      const polygon = pier.geometry.polygon!;
      const centre: [number, number] = [
        polygon.reduce((s, p) => s + p[0], 0) / polygon.length,
        polygon.reduce((s, p) => s + p[1], 0) / polygon.length,
      ];
      expect(nearestOnPolyline(centre, points!).distance, pier.id).toBeLessThanOrEqual(3);
      const profile = profiles.get(deckId)!;
      const top = pier.base! + pier.height!;
      expect(top, pier.id).toBeGreaterThanOrEqual(Math.min(profile.base, profile.baseEnd) - 0.05);
      expect(top, pier.id).toBeLessThanOrEqual(Math.max(profile.base, profile.baseEnd) + 0.05);
      // 河道內的柱底伸至河床，陸上的自地面起算
      expect([0, -9.5], pier.id).toContain(pier.base);
    }
  });

  it("高架依實際交叉關係分層，交會處不等高", () => {
    const profiles = deckProfiles();
    // 塔城街口：環河快速道路（layer 4）在忠孝橋（layer 2）之上
    const bridge = profiles.get("way/51919199")!;
    const expressway = profiles.get("way/51919159")!;
    const gap = Math.min(expressway.base, expressway.baseEnd) - Math.max(bridge.base, bridge.baseEnd);
    expect(gap).toBeGreaterThanOrEqual(TIER_RISE - 1e-6);
    // bridge=viaduct 的環河南路快速道路不再掉成地面路
    const viaduct = baselineById("way/52168897");
    expect(viaduct?.kind).toBe("elevated-road");
    expect(viaduct!.base!).toBeGreaterThan(1);
  });

  it("無 bridge 標籤的落地段自橋面斜降至地面，不再掉成地面路", () => {
    const ramp = baselineById("way/51285123");
    expect(ramp?.kind).toBe("elevated-road");
    expect(ramp?.name).toBe("新生高架道路");
    expect(ramp?.base).toBeCloseTo(0.1, 6);
    expect(ramp!.baseEnd!).toBeCloseTo(8.0 - 1.0, 6);
  });

  it("淡水河沙洲浮出水面，其上的量體以沙洲頂面為地面", () => {
    const sandbar = baselineById("way/25887255");
    expect(sandbar?.kind).toBe("sand");
    expect(sandbar?.name).toBe("中興新洲");
    expect(sandbar!.base! + sandbar!.height!).toBeCloseTo(-2.0, 6);
    // 島上的倉庫與小廟無樓層標籤，不適用一般建物的預設樓層數
    for (const id of ["way/1473629794", "way/1473629795", "way/1473629797"]) {
      const shed = baselineById(id);
      expect(shed?.base, id).toBeCloseTo(-2.0, 6);
      expect(shed?.height, id).toBeCloseTo(2.0, 6);
    }
    expect(baselineById("way/1053487007")?.base).toBeCloseTo(-2.0, 6);
  });

  it("臺鐵萬華站月台與股道同深，不浮在地面", () => {
    const rail = railLevelOf("tra-hsr-station", "B2");
    for (const id of ["way/978708478", "way/978708479"]) {
      const platform = baselineById(id);
      expect(platform?.level, id).toBe("B2");
      expect(platform?.base, id).toBeCloseTo(rail, 6);
      expect(platform?.height, id).toBeCloseTo(PLATFORM_RISE, 6);
    }
    expect(baselineById("way/1228832765")?.base).toBeCloseTo(METRO_LINES.g.rail, 6);
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
