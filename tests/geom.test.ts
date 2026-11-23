import { describe, expect, it } from "vitest";
import { ORIGIN, toLocal, toLonLat, localToScene } from "../src/geo/project.ts";
import { sampleAlignment, alignmentLength } from "../src/geo/alignment.ts";
import { interiorPoint, pointInPolygon, polygonCentroid } from "../src/geo/measure.ts";
import { offsetPolyline, polylineLength, truncatePolyline } from "../src/geo/offset.ts";

/** OSM way/584167409「1月台 (高鐵)」長軸兩端節點，實測長度 331 公尺。 */
const PLATFORM1_WEST: [number, number] = [121.5156818, 25.0477257];
const PLATFORM1_EAST: [number, number] = [121.5189084, 25.0471756];

describe("座標轉換", () => {
  it("原點對應局部座標 (0, 0)", () => {
    const [x, y] = toLocal(ORIGIN.lon, ORIGIN.lat);
    expect(Math.abs(x)).toBeLessThan(0.5);
    expect(Math.abs(y)).toBeLessThan(0.5);
  });

  it("第一月台兩端距離約 331 公尺", () => {
    const a = toLocal(...PLATFORM1_WEST);
    const b = toLocal(...PLATFORM1_EAST);
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    expect(d).toBeGreaterThan(328);
    expect(d).toBeLessThan(334);
  });

  it("月台主軸方位約 −10.7 度（自正東起算）", () => {
    const a = toLocal(...PLATFORM1_WEST);
    const b = toLocal(...PLATFORM1_EAST);
    const bearing = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    expect(bearing).toBeGreaterThan(-11.5);
    expect(bearing).toBeLessThan(-9.9);
  });

  it("經緯度往返轉換誤差小於 1 公釐", () => {
    const local = toLocal(121.5189084, 25.0471756);
    const [lon, lat] = toLonLat(local);
    const back = toLocal(lon, lat);
    expect(Math.hypot(back[0] - local[0], back[1] - local[1])).toBeLessThan(0.001);
  });

  it("場景座標以 Y 為高程、Z 為南", () => {
    expect(localToScene([10, 20], -14.5)).toEqual([10, -14.5, -20]);
  });
});

describe("線形取樣", () => {
  it("半徑 122 公尺、轉角 90 度的圓曲線幾何正確", () => {
    const radius = 122;
    const pts = sampleAlignment(
      { start: [0, 0], bearing: 0, elements: [{ kind: "arc", radius, angle: 90 }] },
      2,
    );
    const end = pts[pts.length - 1];
    expect(Math.hypot(end[0], end[1])).toBeCloseTo(radius * Math.SQRT2, 1);

    // 左轉時圓心位於起點正北 122 公尺處
    const center: [number, number] = [0, radius];
    for (const p of pts) {
      expect(Math.abs(Math.hypot(p[0] - center[0], p[1] - center[1]) - radius)).toBeLessThan(0.1);
    }
  });

  it("右轉圓曲線方向相反", () => {
    const pts = sampleAlignment(
      { start: [0, 0], bearing: 0, elements: [{ kind: "arc", radius: -122, angle: 90 }] },
      2,
    );
    const end = pts[pts.length - 1];
    expect(end[0]).toBeCloseTo(122, 1);
    expect(end[1]).toBeCloseTo(-122, 1);
  });

  it("緩和曲線末端位置與切線角符合三次拋物線", () => {
    const radius = 122;
    const length = 61;
    const pts = sampleAlignment(
      { start: [0, 0], bearing: 0, elements: [{ kind: "transition", radius, length }] },
      0.01,
    );
    const end = pts[pts.length - 1];
    expect(end[0]).toBeCloseTo(length, 6);
    expect(end[1]).toBeCloseTo((length * length) / (6 * radius), 6);

    const prev = pts[pts.length - 2];
    const heading = Math.atan2(end[1] - prev[1], end[0] - prev[0]);
    expect(heading).toBeCloseTo(Math.atan(length / (2 * radius)), 3);
  });

  it("複合線形的取樣長度與理論長度相符", () => {
    const a = {
      start: [0, 0] as [number, number],
      bearing: -10.7,
      elements: [
        { kind: "straight" as const, length: 100 },
        { kind: "transition" as const, radius: 122, length: 61 },
        { kind: "arc" as const, radius: 122, angle: 30 },
        { kind: "straight" as const, length: 50 },
      ],
    };
    const sampled = polylineLength(sampleAlignment(a, 1));
    expect(sampled).toBeCloseTo(alignmentLength(a), 0);
  });
});

describe("折線平移與截取", () => {
  it("直線平移 8 公尺後距離恆為 8", () => {
    const line: [number, number][] = [
      [0, 0],
      [100, 0],
      [200, 0],
    ];
    const moved = offsetPolyline(line, 8);
    for (let i = 0; i < line.length; i++) {
      expect(Math.abs(moved[i][1] - 8)).toBeLessThan(1e-6);
      expect(Math.abs(moved[i][0] - line[i][0])).toBeLessThan(1e-6);
    }
  });

  it("斜線平移後與原線的垂距等於位移量", () => {
    const line: [number, number][] = [
      [0, 0],
      [100, -18.9],
    ];
    const moved = offsetPolyline(line, -8);
    const dx = line[1][0] - line[0][0];
    const dy = line[1][1] - line[0][1];
    const len = Math.hypot(dx, dy);
    const cross = ((moved[0][0] - line[0][0]) * dy - (moved[0][1] - line[0][1]) * dx) / len;
    expect(cross).toBeCloseTo(8, 6);
  });

  it("截取折線得到指定長度", () => {
    const line: [number, number][] = [
      [0, 0],
      [300, 0],
      [300, 300],
    ];
    expect(polylineLength(truncatePolyline(line, 410))).toBeCloseTo(410, 6);
    expect(polylineLength(truncatePolyline(line, 1000))).toBeCloseTo(600, 6);
  });
});

describe("多邊形內點", () => {
  it("凹多邊形的形心落在自身之外時改取內部掃描線中點", () => {
    const ring: [number, number][] = [
      [0, 0],
      [30, 0],
      [30, 30],
      [20, 30],
      [20, 5],
      [10, 5],
      [10, 30],
      [0, 30],
    ];
    expect(pointInPolygon(polygonCentroid(ring), ring)).toBe(false);
    expect(pointInPolygon(interiorPoint(ring), ring)).toBe(true);
  });
});
