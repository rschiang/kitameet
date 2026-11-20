import { describe, expect, it } from "vitest";
import { chainSegments, dedupeSegments } from "../src/geo/chain.ts";
import { polygonize } from "../src/geo/polygonize.ts";
import { medianFilter, rayHit, resample } from "../src/geo/corridor.ts";
import type { Local } from "../src/geo/project.ts";

/** 邊長 10 公尺的正方形四角。 */
const A: Local = [0, 0];
const B: Local = [10, 0];
const C: Local = [10, 10];
const D: Local = [0, 10];

describe("線段串接", () => {
  it("打散且首尾顛倒的四段還原為首尾相接的折線", () => {
    // 順序打亂、其中兩段首尾顛倒
    const segments: [Local, Local][] = [
      [C, B],
      [A, B],
      [D, A],
      [C, D],
    ];
    const lines = chainSegments(segments, { gap: 0.5, angleToleranceDeg: 90, minLength: 5 });
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line).toHaveLength(5);
    const close = Math.hypot(line[4][0] - line[0][0], line[4][1] - line[0][1]);
    expect(close).toBeLessThan(1e-6);
  });

  it("總長小於 minLength 者捨棄", () => {
    const segments: [Local, Local][] = [
      [
        [0, 0],
        [1.5, 0],
      ],
      [
        [1.5, 0],
        [3, 0],
      ],
    ];
    expect(chainSegments(segments, { gap: 0.5, angleToleranceDeg: 30, minLength: 10 })).toEqual([]);
    expect(
      chainSegments(segments, { gap: 0.5, angleToleranceDeg: 30, minLength: 2 }),
    ).toHaveLength(1);
  });

  it("無序端點對去重", () => {
    const segments: [Local, Local][] = [
      [A, B],
      [[10.02, 0.01], [0.01, -0.02]],
      [B, C],
    ];
    const kept = dedupeSegments(segments);
    expect(kept).toHaveLength(2);
    expect(kept[0]).toBe(segments[0]);
  });
});

describe("平面圖解析求面", () => {
  it("矩形加懸垂線只取得矩形一個面", () => {
    const segments: [Local, Local][] = [
      [A, B],
      [B, C],
      [C, D],
      [D, A],
      // 自上緣中點往外伸出的懸垂線
      [
        [5, 10],
        [5, 15],
      ],
    ];
    const faces = polygonize(segments, { snap: 0.08, minArea: 12, maxArea: 40000 });
    expect(faces).toHaveLength(1);
    expect(faces[0]).toHaveLength(4);
    expect(area(faces[0])).toBeCloseTo(100, 6);
  });

  it("兩矩形共用一邊時取得兩個面", () => {
    const segments: [Local, Local][] = [
      [A, B],
      [B, C],
      [C, D],
      [D, A],
      [
        [10, 0],
        [20, 0],
      ],
      [
        [20, 0],
        [20, 10],
      ],
      [
        [20, 10],
        [10, 10],
      ],
      [
        [10, 10],
        [10, 0],
      ],
    ];
    const faces = polygonize(segments, { snap: 0.08, minArea: 12, maxArea: 40000 });
    expect(faces).toHaveLength(2);
    for (const face of faces) expect(area(face)).toBeCloseTo(100, 6);
  });
});

describe("廊帶量測", () => {
  it("等距取樣保留起訖點", () => {
    const pts = resample(
      [
        [0, 0],
        [10, 0],
      ],
      4,
    );
    expect(pts.map((p) => p[0])).toEqual([0, 4, 8, 10]);
    expect(pts.every((p) => p[1] === 0)).toBe(true);
  });

  it("射線命中與落空", () => {
    const segments: [Local, Local][] = [
      [
        [5, -1],
        [5, 1],
      ],
    ];
    expect(rayHit([0, 0], [2, 0], segments, 45)).toBeCloseTo(5, 9);
    expect(rayHit([0, 0], [0, 1], segments, 45)).toBeNull();
    expect(rayHit([0, 0], [1, 0], segments, 4)).toBeNull();
  });

  it("中位數濾波壓掉突波並補 null", () => {
    expect(medianFilter([1, 1, 9, 1, 1], 3)).toEqual([1, 1, 1, 1, 1]);
    expect(medianFilter([1, null, 1], 3)).toEqual([1, 1, 1]);
    expect(medianFilter([1, null, null, null, 9], 3)[2]).toBe(1);
    expect(medianFilter([null, null], 3)).toEqual([0, 0]);
  });
});

/** 環的有向面積，逆時針為正。 */
function area(ring: Local[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}
