import { describe, expect, it } from "vitest";
import { buildBaseline, baselineById } from "../src/data/scene.ts";
import {
  STRUCTURES,
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
import {
  MAX_GRADE,
  METRO_STOPS,
  MIN_TRACK_SEPARATION,
  STEEP_GRADE,
} from "../src/data/structures/metro-profile.ts";
import { elevationAt, vertexElevations } from "../src/data/elevation.ts";
import { dortsStationBoxes } from "../src/data/dorts.ts";
import { decompose, nearestOnPolyline, pointInPolygon, polygonAxis } from "../src/geo/measure.ts";
import type { Local } from "../src/geo/project.ts";
import { OVERGROUND_RING, UNDERGROUND_RING } from "../src/data/coverage.ts";
import { GROUND_EL, PARKING_FLOOR_THICKNESS, PLATFORM_RISE, aboveGround } from "../src/data/schema.ts";
import { featureColor } from "../src/render/palette.ts";

const features = buildBaseline();

/** 折線上每 `step` 公尺的取樣點、該處的切向與弧長。 */
function samplesAlong(line: Local[], step: number): { point: Local; tangent: Local; arc: number }[] {
  const out: { point: Local; tangent: Local; arc: number }[] = [];
  let walked = 0;
  let next = 0;
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (seg === 0) continue;
    const tangent: Local = [(b[0] - a[0]) / seg, (b[1] - a[1]) / seg];
    while (next <= walked + seg) {
      const t = next - walked;
      out.push({ point: [a[0] + tangent[0] * t, a[1] + tangent[1] * t], tangent, arc: next });
      next += step;
    }
    walked += seg;
  }
  return out;
}

/** 點在折線上的投影：距離與弧長。 */
function projectArc(line: Local[], p: Local): { distance: number; arc: number } {
  let best = { distance: Infinity, arc: 0 };
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const [vx, vy] = [b[0] - a[0], b[1] - a[1]];
    const len = Math.hypot(vx, vy);
    const t = len === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (len * len)));
    const distance = Math.hypot(a[0] + vx * t - p[0], a[1] + vy * t - p[1]);
    if (distance < best.distance) best = { distance, arc: walked + t * len };
    walked += len;
  }
  return best;
}

const metroTracks = features.filter(
  (f) => f.kind === "track-metro" && f.line !== undefined && (f.geometry.polyline?.length ?? 0) >= 2,
);

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
      // 月台長邊依相鄰軌道重建，伸入道岔區的端部裁去：第 1 月台約短 13 公尺
      expect(longestSpan(f!.geometry.polygon!)).toBeGreaterThan(315);
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
    const top = Math.max(...parts.map((f) => (f.base ?? GROUND_EL) + (f.height ?? 0)));
    expect(top).toBeCloseTo(aboveGround(48), 6);
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

  it("K 區地下停車場只畫一層樓面", () => {
    const k = baselineById("way/204711163");
    expect(k?.kind).toBe("parking");
    expect(k?.layer).toBe("mall");
    expect(k?.level).toBe("B2");
    expect(k?.height).toBe(PARKING_FLOOR_THICKNESS);
    expect(k?.base).toBe(levelOf("mall-k", "B2").floor);
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
    expect(baselineById("station/box")?.base).toBe(STRUCTURES["tra-hsr-station"].bottom);
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
      expect(feature!.base, id).toBeCloseTo(aboveGround(-1.0), 6);
      expect(feature!.baseEnd!, id).toBeCloseTo(railLevelOf("tra-hsr-station", "B2"), 6);
    }
  });

  it("月台範圍內軌道水平，且與月台等高", () => {
    const byId = new Map(features.map((f) => [f.id, f]));
    for (const stop of METRO_STOPS) {
      const platforms = stop.platforms.map((id) => {
        const platform = byId.get(id);
        expect(platform?.geometry.polygon, `${stop.name} ${id}`).toBeDefined();
        return platform!;
      });
      const bases = platforms.map((p) => p.base!);
      const hit = new Set<number>();
      const tracks = metroTracks.filter((f) => stop.lines.includes(f.line as MetroLineId));
      for (const platform of platforms) {
        const axis = polygonAxis(platform.geometry.polygon!);
        const [ux, uy] = [Math.cos((axis.bearing * Math.PI) / 180), Math.sin((axis.bearing * Math.PI) / 180)];
        for (const track of tracks) {
          for (const { point, tangent, arc } of samplesAlong(track.geometry.polyline!, 1)) {
            const { along, lateral } = decompose(axis.center, axis.bearing, point);
            if (Math.abs(along) > axis.length / 2 || Math.abs(lateral) > axis.width / 2 + 4) continue;
            if (Math.abs(tangent[0] * ux + tangent[1] * uy) < Math.cos((15 * Math.PI) / 180)) continue;
            const z = elevationAt(track)(arc);
            const match = bases.findIndex((b) => Math.abs(b - z) <= 1e-6);
            expect(match, `${stop.name} ${track.id} (${point.map((v) => v.toFixed(1))}) EL ${z}`).toBeGreaterThanOrEqual(0);
            hit.add(bases[match]);
          }
        }
      }
      for (const base of bases) expect(hit.has(base), `${stop.name} 月台 EL ${base} 沒有軌道`).toBe(true);
    }
  });

  it("西門站與中正紀念堂站的正線分列上下兩層，月台與軌道等高", () => {
    const cases: { stop: string; structure: StructureId; levels: Record<string, "B2" | "B3"> }[] = [
      {
        stop: "西門",
        structure: "metro-station-ximen",
        levels: {
          "metro/bl/to-nangang": "B2",
          "metro/g/to-songshan": "B2",
          "metro/bl/to-dingpu": "B3",
          "metro/g/to-xindian": "B3",
        },
      },
      {
        stop: "中正紀念堂",
        structure: "metro-station-cks",
        levels: {
          "metro/r/to-tamsui": "B2",
          "metro/g/to-songshan": "B2",
          "metro/r/to-xiangshan": "B3",
          "metro/g/to-xindian": "B3",
        },
      },
    ];
    for (const { stop, structure, levels } of cases) {
      const platforms = METRO_STOPS.find((s) => s.name === stop)!.platforms.map((id) => baselineById(id)!);
      expect(platforms.length, stop).toBe(2);
      for (const platform of platforms) {
        expect(platform.base!, platform.id).toBeCloseTo(railLevelOf(structure, platform.level), 6);
        expect(platform.height!, platform.id).toBeCloseTo(PLATFORM_RISE, 6);
      }
      for (const [id, level] of Object.entries(levels)) {
        const main = baselineById(id);
        expect(main, id).toBeDefined();
        const at = elevationAt(main!);
        let hits = 0;
        for (const platform of platforms) {
          const axis = polygonAxis(platform.geometry.polygon!);
          for (const { point, arc } of samplesAlong(main!.geometry.polyline!, 1)) {
            const { along, lateral } = decompose(axis.center, axis.bearing, point);
            if (Math.abs(along) > axis.length / 2 || Math.abs(lateral) > axis.width / 2 + 4) continue;
            hits++;
            const label = `${stop} ${id} (${point.map((v) => v.toFixed(1))})`;
            expect(at(arc), label).toBeCloseTo(railLevelOf(structure, level), 6);
          }
        }
        expect(hits, `${stop} ${id}`).toBeGreaterThan(0);
      }
    }
  });

  it("正線縱坡不超過 3%（西門—北門間松山新店線為 3.5%），配線不超過 3.5%", () => {
    let sloped = 0;
    for (const f of metroTracks) {
      const line = f.geometry.polyline!;
      const z = vertexElevations(f);
      for (let i = 1; i < line.length; i++) {
        const [a, b] = [line[i - 1], line[i]];
        const run = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (run === 0) continue;
        const grade = Math.abs(z[i] - z[i - 1]) / run;
        if (grade > 0) sloped++;
        const [x, y] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        // 配線依兩端軌道面或兩側正線推得，位於彎道內側時沿線長度較短，縱坡略陡於正線
        const steep = f.trackRole !== "main" || (f.line === "g" && x < -600 && y > -480 && y < 90);
        expect(grade, `${f.id} (${x.toFixed(1)}, ${y.toFixed(1)})`).toBeLessThanOrEqual(
          (steep ? STEEP_GRADE : MAX_GRADE) + 1e-9,
        );
      }
    }
    expect(sloped).toBeGreaterThan(0);
  });

  it("不同路線的捷運軌道平面交會處，上下高差不小於潛盾外徑", () => {
    const boxOf = (line: Local[]) => {
      const xs = line.map((p) => p[0]);
      const ys = line.map((p) => p[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    };
    const items = metroTracks.map((f) => ({
      f,
      at: elevationAt(f),
      line: f.geometry.polyline!,
      box: boxOf(f.geometry.polyline!),
    }));
    /** 配線與其銜接的軌道、同一條 OSM way 拆出的上下兩條配線，本就相接或上下重疊。 */
    const related = (a: (typeof items)[number]["f"], b: (typeof items)[number]["f"]): boolean =>
      (a.joins?.includes(b.id) ?? false) ||
      (b.joins?.includes(a.id) ?? false) ||
      (a.trackRole !== "main" &&
        b.trackRole !== "main" &&
        a.id.split("/").slice(0, 2).join("/") === b.id.split("/").slice(0, 2).join("/"));
    let crossings = 0;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const [a, b] = [items[i], items[j]];
        if (a.f.line === b.f.line || related(a.f, b.f)) continue;
        if (a.box[0] > b.box[2] || b.box[0] > a.box[2] || a.box[1] > b.box[3] || b.box[1] > a.box[3]) continue;
        let arcA = 0;
        for (let p = 1; p < a.line.length; p++) {
          const [p0, p1] = [a.line[p - 1], a.line[p]];
          const lenA = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
          let arcB = 0;
          for (let q = 1; q < b.line.length; q++) {
            const [q0, q1] = [b.line[q - 1], b.line[q]];
            const lenB = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]);
            const [rx, ry, sx, sy] = [p1[0] - p0[0], p1[1] - p0[1], q1[0] - q0[0], q1[1] - q0[1]];
            const denom = rx * sy - ry * sx;
            if (denom !== 0) {
              const t = ((q0[0] - p0[0]) * sy - (q0[1] - p0[1]) * sx) / denom;
              const u = ((q0[0] - p0[0]) * ry - (q0[1] - p0[1]) * rx) / denom;
              if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
                crossings++;
                const gap = Math.abs(a.at(arcA + t * lenA) - b.at(arcB + u * lenB));
                expect(gap, `${a.f.id} × ${b.f.id}`).toBeGreaterThanOrEqual(MIN_TRACK_SEPARATION - 1e-6);
              }
            }
            arcB += lenB;
          }
          arcA += lenA;
        }
      }
    }
    expect(crossings).toBeGreaterThan(10);
  });

  it("同一路線上下疊式的兩條正線，潛盾段上下間距不小於潛盾外徑", () => {
    // 車站箱涵內沒有潛盾，板南線在臺北車站箱涵內才轉為左右並列，上層於箱涵外牆起即開始下降
    const boxes = dortsStationBoxes();
    const mains = metroTracks.filter((f) => f.trackRole === "main" && f.line !== "a");
    for (const line of new Set(mains.map((f) => f.line))) {
      const [a, b] = mains.filter((f) => f.line === line);
      const [atA, atB] = [elevationAt(a), elevationAt(b)];
      for (const { point, arc } of samplesAlong(a.geometry.polyline!, 2)) {
        if (!pointInPolygon(point, UNDERGROUND_RING) || boxes.some((box) => pointInPolygon(point, box))) continue;
        const other = projectArc(b.geometry.polyline!, point);
        if (other.distance >= 3) continue;
        const gap = Math.abs(atA(arc) - atB(other.arc));
        expect(gap, `${line} (${point.map((v) => v.toFixed(1))})`).toBeGreaterThanOrEqual(MIN_TRACK_SEPARATION - 1e-6);
      }
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
    expect(canopy!.base!).toBeGreaterThan(aboveGround(3));
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
      expect([GROUND_EL, aboveGround(-9.5)], pier.id).toContain(pier.base);
    }
  });

  it("等高的高架主線在涵蓋範圍內皆有橋面", () => {
    const profiles = deckProfiles();
    const decks = features.filter((f) => f.id.startsWith("road/merged/elevated-road|"));
    const missing: string[] = [];
    for (const { id, points } of deckCentrelines()) {
      const profile = profiles.get(id);
      if (!profile || Math.abs(profile.base - profile.baseEnd) > 1e-6) continue;
      const own = decks.filter((f) => Math.abs((f.base as number) - profile.base) < 1e-6);
      let total = 0;
      let missed = 0;
      for (let i = 0; i + 1 < points.length; i++) {
        const [a, b] = [points[i], points[i + 1]];
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 5));
        for (let k = 0; k < steps; k++) {
          const t = (k + 0.5) / steps;
          const q: [number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
          if (!pointInPolygon(q, OVERGROUND_RING)) continue;
          total++;
          if (!own.some((f) => pointInPolygon(q, f.geometry.polygon!))) missed++;
        }
      }
      if (missed > 0) missing.push(`${id} ${missed}/${total}`);
    }
    expect(missing).toEqual([]);
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
    expect(viaduct!.base!).toBeGreaterThan(aboveGround(1));
  });

  it("無 bridge 標籤的落地段自橋面斜降至地面，不再掉成地面路", () => {
    const ramp = baselineById("way/51285123");
    expect(ramp?.kind).toBe("elevated-road");
    expect(ramp?.name).toBe("新生高架道路");
    const elevations = vertexElevations(ramp!);
    expect(elevations[0]).toBeCloseTo(aboveGround(0.1), 6);
    expect(elevations[elevations.length - 1]).toBeCloseTo(aboveGround(8.0 - 1.0), 6);
  });

  it("忠孝橋引道自橋面斜降至忠孝西路", () => {
    // 落地端的橋面頂與匝道落地端齊平：匝道落地高程加匝道梁深，再扣主線梁深
    const landing = aboveGround(0.1) + 1.0 - 1.8;
    const eastbound = baselineById("way/909274074");
    expect(eastbound?.kind).toBe("elevated-road");
    const east = vertexElevations(eastbound!);
    const points = eastbound!.geometry.polyline!;
    expect(points[points.length - 1][0]).toBeCloseTo(-984.6, 1);
    expect(points[points.length - 1][1]).toBeCloseTo(85.38, 1);
    expect(east[east.length - 1]).toBeCloseTo(landing, 6);
    expect(east[0]).toBeCloseTo(deckProfiles().get("way/909274074")!.base, 6);
    expect(east[0]).toBeGreaterThan(aboveGround(5));

    // 機慢車道 way/820121741 的匯入點為錨點，自此以東才開始下降
    const westbound = baselineById("way/51919199");
    const west = vertexElevations(westbound!);
    expect(west[0]).toBeCloseTo(landing, 6);
    expect(westbound!.geometry.polyline![1][0]).toBeCloseTo(-1067.43, 1);
    expect(west[1]).toBeGreaterThan(aboveGround(5));
  });

  it("接在路段中間頂點的匝道也能落地與上橋", () => {
    // 南京西路出口匝道落在環河北路的中間頂點
    const nanjing = vertexElevations(baselineById("way/51919193")!);
    expect(nanjing[nanjing.length - 1]).toBeCloseTo(aboveGround(0.1), 6);
    // 忠孝橋出口匝道起於環河快速道路的中間頂點
    expect(vertexElevations(baselineById("way/51919189")!)[0]).toBeGreaterThan(aboveGround(5));
    // 環河南路快速道路落地段：首頂點落在地面道路上
    expect(vertexElevations(baselineById("way/888902276")!)[0]).toBeCloseTo(aboveGround(0.1), 6);
  });

  it("淡水河沙洲浮出水面，其上的量體以沙洲頂面為地面", () => {
    const sandbar = baselineById("way/25887255");
    expect(sandbar?.kind).toBe("sand");
    expect(sandbar?.name).toBe("中興新洲");
    expect(sandbar!.base! + sandbar!.height!).toBeCloseTo(aboveGround(-2.0), 6);
    // 島上的倉庫與小廟無樓層標籤，不適用一般建物的預設樓層數
    for (const id of ["way/1473629794", "way/1473629795", "way/1473629797"]) {
      const shed = baselineById(id);
      expect(shed?.base, id).toBeCloseTo(aboveGround(-2.0), 6);
      expect(shed?.height, id).toBeCloseTo(2.0, 6);
    }
    expect(baselineById("way/1053487007")?.base).toBeCloseTo(aboveGround(-2.0), 6);
  });

  it("臺鐵萬華站月台與股道同深，不浮在地面", () => {
    const rail = railLevelOf("tra-hsr-station", "B2");
    for (const id of ["way/978708478", "way/978708479"]) {
      const platform = baselineById(id);
      expect(platform?.level, id).toBe("B2");
      expect(platform?.base, id).toBeCloseTo(rail, 6);
      expect(platform?.height, id).toBeCloseTo(PLATFORM_RISE, 6);
    }
    expect(baselineById("way/1228832765")?.base).toBeCloseTo(aboveGround(-14.5), 6);
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

  it("所有月台同色，不退回捷運圖層色", () => {
    const platforms = features.filter((f) => f.kind === "platform");
    expect(platforms.map((f) => f.id)).toContain("way/741259905");
    for (const f of platforms) {
      expect(featureColor(f.kind, f.layer, f.status, f.line), f.id).toBe("#cfc8bb");
    }
  });
});
