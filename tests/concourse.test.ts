import { describe, expect, it } from "vitest";
import { featuresFor } from "../src/app/scenario.ts";
import { levelOf, railLevelOf } from "../src/data/levels.ts";
import { baselineById, buildBaseline } from "../src/data/scene.ts";
import { GROUND_EL, PLATFORM_RISE, type Feature } from "../src/data/schema.ts";
import {
  advance,
  decompose,
  nearestOnPolyline,
  pointInPolygon,
  polygonAxis,
  polygonCentroid,
} from "../src/geo/measure.ts";
import { corridorPolygon } from "../src/geo/offset.ts";
import type { Local } from "../src/geo/project.ts";
import { buildFeatureMesh } from "../src/render/builders.ts";
import { sceneY } from "../src/render/depth.ts";

const features = buildBaseline();
const stationOutline = baselineById("station/box")!.geometry.polygon!;
const axis = polygonAxis(stationOutline);
const stationFloor = levelOf("tra-hsr-station", "B1").floor;
const metroFloor = levelOf("metro-station", "B1").floor;
const mallFloor = levelOf("mall-z", "B1").floor;
const platformTop = railLevelOf("tra-hsr-station", "B2") + PLATFORM_RISE;

const climbs = features.filter((f) => f.kind === "stairs" || f.kind === "escalator");
const near = (a: number | undefined, b: number): boolean =>
  a !== undefined && Math.abs(a - b) < 1e-6;
const platformStairs = features.filter(
  (f) => f.kind === "stairs" && near(f.base, platformTop) && near(f.baseEnd, stationFloor),
);

describe("樓層分階", () => {
  it("圖面的 B1 高差與實地踏查的階數相符：17 階與 23 階換得同一個級高", () => {
    const upper = (stationFloor - metroFloor) / 17;
    const lower = (metroFloor - mallFloor) / 23;
    // 一般階梯級高 15 至 18 公分；兩段獨立踏查的級高應一致
    for (const riser of [upper, lower]) {
      expect(riser).toBeGreaterThan(0.15);
      expect(riser).toBeLessThan(0.18);
    }
    expect(Math.abs(upper - lower)).toBeLessThan(0.002);
  });

  it("K 區地下街比站前地下街高 0.8 公尺", () => {
    expect(levelOf("mall-k", "B1").floor - mallFloor).toBeCloseTo(0.8, 6);
  });
});

describe("站體 B1 環廊", () => {
  const bands = features
    .filter((f) => f.kind === "passage" && f.structure === "tra-hsr-station")
    .map((f) => corridorPolygon(f.geometry.polyline!, f.width!));
  const inBand = (p: Local): boolean => bands.some((band) => pointInPolygon(p, band));
  const origin = polygonCentroid(baselineById("station/parking/west")!.geometry.polygon!);

  it("舊的內縮環廊已移除", () => {
    const synthetic = features.filter(
      (f) => f.id.startsWith("station/corridor/") || f.id.startsWith("station/passage/"),
    );
    expect(synthetic).toEqual([]);
  });

  it("西停車場的北、南、西三面皆為環廊", () => {
    expect(inBand(origin)).toBe(false);
    for (const turn of [90, -90, 180]) {
      let reached = false;
      for (let d = 2; d <= 120 && !reached; d += 2) {
        reached = inBand(advance(origin, axis.bearing + turn, d));
      }
      expect(reached, `方位 ${turn}`).toBe(true);
    }
  });

  it("自西停車場向東依序穿越三條南北向通道", () => {
    let crossings = 0;
    let inside = false;
    for (let d = 2; d <= 320; d += 2) {
      const now = inBand(advance(origin, axis.bearing, d));
      if (now && !inside) crossings += 1;
      inside = now;
    }
    expect(crossings).toBeGreaterThanOrEqual(3);
  });
});

describe("階梯與出口", () => {
  it("出口 M1 至 M8 皆自捷運 B1 通到地面", () => {
    for (let n = 1; n <= 8; n++) {
      const exit = climbs.find((f) => f.name === `出口 M${n}`);
      expect(exit, `M${n}`).toBeDefined();
      expect(exit!.base, `M${n}`).toBe(metroFloor);
      expect(exit!.baseEnd, `M${n}`).toBeCloseTo(GROUND_EL, 6);
    }
  });

  it("16 座月台階梯自月台面通到站體 B1，全部落在站體輪廓內", () => {
    expect(platformStairs).toHaveLength(16);
    for (const stair of platformStairs) {
      for (const point of stair.geometry.polyline!) {
        expect(pointInPolygon(point, stationOutline), stair.id).toBe(true);
      }
    }
  });

  it("站體環廊與捷運 B1 之間有 17 階的階梯相連", () => {
    const links = features.filter(
      (f) => f.kind === "stairs" && near(f.base, metroFloor) && near(f.baseEnd, stationFloor),
    );
    expect(links.length).toBeGreaterThanOrEqual(1);
  });

  it("階梯建成逐級抬升的量體，不是斜板", () => {
    const stair = platformStairs[0];
    const geometry = buildFeatureMesh(stair)!.geometry;
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.y).toBeCloseTo(sceneY(stair.base! - stair.height!), 3);
    expect(geometry.boundingBox!.max.y).toBeCloseTo(sceneY(stair.baseEnd!), 3);

    const position = geometry.getAttribute("position");
    const heights = new Set<string>();
    for (let i = 0; i < position.count; i++) heights.add(position.getY(i).toFixed(3));
    expect(heights.size).toBeGreaterThanOrEqual(6);
  });
});

describe("付費區", () => {
  it("各區北半為臺鐵、南半為高鐵", () => {
    const rooms = features.filter((f) => f.kind === "station" && f.id.startsWith("indoor/"));
    expect(rooms).toHaveLength(4);
    const lineOf = (north: boolean): (Feature["line"] | undefined)[] =>
      rooms
        .filter((room) => {
          const centre = polygonCentroid(room.geometry.polygon!);
          return decompose(axis.center, axis.bearing, centre).lateral > 0 === north;
        })
        .map((room) => room.line);
    expect(lineOf(true)).toEqual(["tra", "tra"]);
    expect(lineOf(false)).toEqual(["hsr", "hsr"]);
  });
});

describe("出入口雨棚", () => {
  const roofs = features.filter((f) => f.kind === "exit-shed" && f.id.endsWith("/shed/roof"));

  it("出口 M1 的雨棚罩住階梯的地面端", () => {
    const stair = baselineById("indoor/way/1211599713")!;
    const roof = baselineById("indoor/way/1211599713/shed/roof");
    expect(roof).toBeDefined();
    const line = stair.geometry.polyline!;
    expect(pointInPolygon(line[line.length - 1], roof!.geometry.polygon!)).toBe(true);
    expect(roof!.base).toBeCloseTo(GROUND_EL + 3.6, 6);
    expect(roof!.geometry.polygonTop).toBeDefined();
  });

  it("開在建物內的出入口不設雨棚", () => {
    expect(baselineById("indoor/way/840113720/shed/roof")).toBeUndefined();
    expect(baselineById("indoor/way/1305073200/shed/roof")).toBeUndefined();
    expect(roofs).toHaveLength(30);
  });

  it("雨棚範圍內的建物面已由雨棚取代", () => {
    const covered = features.filter(
      (f) =>
        f.kind === "building" &&
        f.geometry.polygon &&
        roofs.some((roof) =>
          pointInPolygon(polygonCentroid(f.geometry.polygon!), roof.geometry.polygon!),
        ),
    );
    expect(covered.map((f) => f.id)).toEqual([]);
  });
});

describe("方案拆除", () => {
  const mallK = baselineById("way/450732441")!.geometry.polygon!;
  /** B1 與地面層的動線量體中，落在 K 區地下街輪廓內的部分。 */
  const insideMall = (scenario: "status-quo" | "proposal-b" | "proposal-c"): string[] =>
    featuresFor(scenario)
      .filter((f) => {
        if (f.status === "removed" || f.layer !== "passage") return false;
        if (f.level !== "B1" && f.level !== "G") return false;
        const { polygon, polyline } = f.geometry;
        const points = polygon ? [...polygon, polygon[0]] : polyline;
        if (!points) return false;
        return points.some((p, i) => {
          if (i === 0) return false;
          const q = points[i - 1];
          return pointInPolygon([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], mallK);
        });
      })
      .map((f) => f.id);

  it("K 區地下街拆除時，其範圍內的 B1 動線一併拆除", () => {
    // 同一檢查套在現況必定有量體落在輪廓內，否則這則測試無從失敗
    expect(insideMall("status-quo").length).toBeGreaterThan(0);
    for (const scenario of ["proposal-b", "proposal-c"] as const) {
      expect(insideMall(scenario), scenario).toEqual([]);
    }
  });

  it("K 區內的階梯整座拆除、跨越輪廓的通道只拆除界內段", () => {
    const byId = new Map(featuresFor("proposal-b").map((f) => [f.id, f]));
    expect(byId.get("indoor/way/1305073206")?.status).toBe("removed");
    expect(byId.get("indoor/way/1305073202/cleared")?.status).toBe("removed");
    expect(byId.get("indoor/way/1305073202"), "界外段保留").toBeDefined();
  });
});

describe("B3 共用穿堂", () => {
  const stationB3 = levelOf("tra-hsr-station", "B3").floor;

  it("四座月台電扶梯自 B3 穿堂直上月台面", () => {
    const escalators = features.filter(
      (f) => f.kind === "escalator" && near(f.base, stationB3) && near(f.baseEnd, platformTop),
    );
    expect(escalators).toHaveLength(4);
    for (const f of escalators) expect(f.level, f.id).toBe("B3");
  });

  it("穿堂樓板位於月台層下方", () => {
    const hall = baselineById("station/concourse/B3")!;
    expect(hall.base! + hall.height!).toBeLessThanOrEqual(railLevelOf("tra-hsr-station", "B2") - 1.0);
    expect(hall.level).toBe("B3");
  });

  it("穿堂延伸到淡水信義線車站箱涵", () => {
    const box = baselineById("metro/tamsui/concourse/B3")!.geometry.polygon!;
    const ring = [...box, box[0]];
    const hall = baselineById("station/concourse/B3")!.geometry.polygon!;
    const touching = hall.filter((p) => nearestOnPolyline(p, ring).distance < 0.01);
    expect(touching.length).toBeGreaterThanOrEqual(2);
  });
});

describe("捷運站內梯組", () => {
  const polygonOf = (id: string): Local[] => baselineById(id)!.geometry.polygon!;
  const rBox = polygonOf("metro/tamsui/concourse/B3");
  const blBox = polygonOf("metro/bannan/concourse/B2");
  const arm = polygonOf("metro/bannan/concourse/B2/north");
  const mallK = polygonOf("way/450732441");
  const tamsuiPlatform = polygonOf("way/741259905");
  const bannanPlatform = polygonOf("way/741259904");
  const b2Floor = levelOf("metro-station", "B2").floor;

  const lanes = (prefix: string): Feature[] => features.filter((f) => f.id.startsWith(prefix));
  const kinds = (prefix: string): string[] => lanes(prefix).map((f) => f.kind).sort();
  const band = (f: Feature): Local[] => corridorPolygon(f.geometry.polyline!, f.width!);
  const lower = (f: Feature): Local => f.geometry.polyline![0];
  const upper = (f: Feature): Local => f.geometry.polyline![f.geometry.polyline!.length - 1];
  /** 沿月台主軸分解的函式；`along` 往主軸方位增加、`lateral` 以左側為正。 */
  const frameOf = (platform: Local[]) => {
    const platformAxis = polygonAxis(platform);
    return (p: Local) => decompose(platformAxis.center, platformAxis.bearing, p);
  };

  it("各組的電扶梯與階梯道數依資訊圖", () => {
    const three = ["escalator", "escalator", "stairs"];
    expect(kinds("metro/transfer/B4/")).toEqual(three);
    expect(kinds("metro/transfer/B3/west/")).toEqual(three);
    expect(kinds("metro/transfer/B3/east/")).toEqual(["escalator", "escalator"]);
    for (let n = 1; n <= 4; n++) {
      expect(kinds(`metro/bannan/platform/${n}/`), `板南線第 ${n} 組`).toEqual(three);
    }
  });

  it("K 區地下街下方的舊轉乘動線已移除", () => {
    for (const id of ["metro/transfer/B3", "metro/transfer/escalator/1", "metro/transfer/escalator/2"]) {
      expect(baselineById(id), id).toBeUndefined();
    }
    const under = features.filter(
      (f) =>
        f.layer === "passage" &&
        (f.level === "B3" || f.level === "B4") &&
        (f.geometry.polygon ?? f.geometry.polyline ?? []).some((p) => pointInPolygon(p, mallK)),
    );
    expect(under.map((f) => f.id)).toEqual([]);
  });

  it("大廳層北側延伸段與板南線大廳同高，南端伸入板南線箱涵", () => {
    expect(baselineById("metro/bannan/concourse/B2/north")!.base).toBe(b2Floor);
    expect(arm.some((p) => pointInPolygon(p, blBox))).toBe(true);
  });

  it("延伸段的梯組落在淡水信義線箱涵內，上端接延伸段", () => {
    const all = lanes("metro/transfer/");
    expect(all).toHaveLength(8);
    const armRing = [...arm, arm[0]];
    for (const f of all) {
      for (const corner of band(f)) {
        expect(pointInPolygon(corner, rBox), `${f.id} 超出箱涵`).toBe(true);
        expect(pointInPolygon(corner, mallK), `${f.id} 落在 K 區`).toBe(false);
      }
      const top = upper(f);
      expect(
        pointInPolygon(top, arm) || nearestOnPolyline(top, armRing).distance < 0.01,
        `${f.id} 上端`,
      ).toBe(true);
      expect(f.baseEnd, f.id).toBeCloseTo(b2Floor, 6);
    }
  });

  it("中段梯組通往淡水信義線月台南端，北端兩組通往大廳層", () => {
    const toPlatform = lanes("metro/transfer/B4/");
    const toConcourse = lanes("metro/transfer/B3/");
    for (const f of toPlatform) {
      expect(f.base, f.id).toBe(railLevelOf("metro-station-r", "B4") + PLATFORM_RISE);
      expect(pointInPolygon(lower(f), tamsuiPlatform), `${f.id} 下端`).toBe(true);
    }
    for (const f of toConcourse) {
      expect(f.base, f.id).toBe(levelOf("metro-station-r", "B3").floor);
    }

    // 淡水信義線月台主軸方位約 62 度，along 往北增加
    const along = (p: Local): number => frameOf(tamsuiPlatform)(p).along;
    const southmostTip = Math.min(...toConcourse.map((f) => along(upper(f))));
    for (const f of toPlatform) expect(along(upper(f)), f.id).toBeLessThan(southmostTip);
    for (const f of toConcourse) expect(along(upper(f)), f.id).toBeLessThan(along(lower(f)));
  });

  it("板南線四組梯組落在月台範圍內，上端朝月台中央，自大廳層往下看電扶梯在左側", () => {
    const frame = frameOf(bannanPlatform);
    for (let n = 1; n <= 4; n++) {
      const group = lanes(`metro/bannan/platform/${n}/`);
      // 月台主軸往東：第 1、2 組在中點以西，上行往東；第 3、4 組相反
      const westHalf = n <= 2;
      for (const f of group) {
        for (const corner of band(f)) {
          expect(pointInPolygon(corner, bannanPlatform), `${f.id} 超出月台`).toBe(true);
        }
        expect(f.base, f.id).toBe(railLevelOf("metro-station", "B3") + PLATFORM_RISE);
        expect(f.baseEnd, f.id).toBeCloseTo(b2Floor, 6);
        expect(frame(upper(f)).along > frame(lower(f)).along, `${f.id} 上行方向`).toBe(westHalf);
        expect(Math.abs(frame(upper(f)).along), `${f.id} 上端`).toBeLessThan(
          Math.abs(frame(lower(f)).along),
        );
      }
      const stairs = frame(upper(group.find((f) => f.kind === "stairs")!)).lateral;
      for (const f of group.filter((lane) => lane.kind === "escalator")) {
        // 往西下行時左側為南（lateral 較小），往東下行時左側為北
        expect(frame(upper(f)).lateral < stairs, `${f.id} 側別`).toBe(westHalf);
      }
    }
  });

  it("K 區地下街內的電梯只到停車場層", () => {
    for (const id of ["indoor/node/12087421735", "indoor/node/12087421748"]) {
      expect(baselineById(id)?.base, id).toBe(levelOf("mall-k", "B2").floor);
    }
  });
});
