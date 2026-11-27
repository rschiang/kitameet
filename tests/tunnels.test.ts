/**
 * 潛盾圓管由所在的正線產生：軸心緊貼軌道上方、彼此不相交，且公告圖的潛盾範圍都有圓管。
 */
import { describe, expect, it } from "vitest";
import { buildBaseline } from "../src/data/scene.ts";
import { BORE_AXIS_RISE, dortsBores } from "../src/data/dorts.ts";
import { UNDERGROUND_RING } from "../src/data/coverage.ts";
import { elevationAt, vertexElevations } from "../src/data/elevation.ts";
import { TBM_LINING } from "../src/data/structures/tunnels.ts";
import { pointInPolygon } from "../src/geo/measure.ts";
import { offsetPolyline, polylineLength } from "../src/geo/offset.ts";
import type { Local } from "../src/geo/project.ts";
import type { Feature } from "../src/data/schema.ts";

const features = buildBaseline();
const tubes = features.filter((f) => (f.geometry.tube?.length ?? 0) >= 2);
/** 沿單一正線的圓管；雙圓潛盾沿兩條正線的中線，另行檢查。 */
const trackTubes = tubes.filter((f) => f.twinSpacing === undefined);
const tracks = features.filter((f) => f.kind === "track-metro" && (f.geometry.polyline?.length ?? 0) >= 2);

/** 折線上每 `step` 公尺的取樣點與弧長（含終點）。 */
function samplesAlong(line: Local[], step: number): { point: Local; arc: number }[] {
  const out: { point: Local; arc: number }[] = [];
  let walked = 0;
  let next = 0;
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (seg > 0 && next <= walked + seg) {
      const t = (next - walked) / seg;
      out.push({ point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], arc: next });
      next += step;
    }
    walked += seg;
  }
  out.push({ point: line[line.length - 1], arc: walked });
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

/** 圓管的來源軌道（去除切段編號）。 */
const sourceTrack = (tube: Feature): string => tube.id.slice(tube.id.indexOf("@") + 1).split("#")[0];

describe("潛盾圓管", () => {
  it("有圓管，且一部分隨正線的坡度傾斜；臺北捷運的圓管環片厚 0.25 公尺", () => {
    expect(trackTubes.length).toBeGreaterThan(20);
    expect(trackTubes.some((t) => new Set(vertexElevations(t)).size > 1)).toBe(true);
    for (const tube of trackTubes) expect(tube.lining, tube.id).toBe(TBM_LINING);
  });

  it("軸心沿同路線的正線，高出軌道面 1.5 公尺", () => {
    for (const tube of trackTubes) {
      const axis = tube.geometry.tube!;
      const tubeAt = elevationAt(tube);
      const candidates = tracks.filter((t) => t.line === tube.line);
      for (const { point, arc } of samplesAlong(axis, 1)) {
        const z = tubeAt(arc);
        const matched = candidates.some((track) => {
          const line = track.geometry.polyline!;
          const hit = projectArc(line, point);
          return hit.distance <= 0.01 && Math.abs(elevationAt(track)(hit.arc) + BORE_AXIS_RISE - z) <= 0.01;
        });
        expect(matched, `${tube.id} (${point.map((v) => v.toFixed(1))}) EL ${z.toFixed(3)}`).toBe(true);
      }
    }
  });

  it("不同正線的圓管互不相交", () => {
    // 雙圓潛盾拆成左右兩個圓，各以半徑比對
    const circles = tubes.flatMap((tube) => {
      const axis = tube.geometry.tube!;
      const at = elevationAt(tube);
      const offsets = tube.twinSpacing === undefined ? [0] : [tube.twinSpacing / 2, -tube.twinSpacing / 2];
      return offsets.map((offset) => ({ tube, axis: offset === 0 ? axis : offsetPolyline(axis, offset), at }));
    });
    const sampled = circles.map(({ tube, axis, at }) => {
      const length = polylineLength(axis);
      const radius = tube.radius!;
      // 平移後的軸線弧長與原軸線略有出入；雙圓潛盾全段等高，取比例換算
      const scale = polylineLength(tube.geometry.tube!) / length;
      const points = samplesAlong(axis, 0.5).map(({ point, arc }) => ({ point, arc, z: at(arc * scale) }));
      const xs = axis.map((p) => p[0]);
      const ys = axis.map((p) => p[1]);
      return {
        tube,
        radius,
        length,
        points,
        box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      };
    });
    for (let i = 0; i < sampled.length; i++) {
      for (let j = i + 1; j < sampled.length; j++) {
        const [a, b] = [sampled[i], sampled[j]];
        if (sourceTrack(a.tube) === sourceTrack(b.tube)) continue;
        const reach = a.radius + b.radius;
        if (a.box[0] > b.box[2] + reach || b.box[0] > a.box[2] + reach) continue;
        if (a.box[1] > b.box[3] + reach || b.box[1] > a.box[3] + reach) continue;
        // 端部與相接的圓管共用端點，不列入
        const inner = (s: { arc: number }, length: number) => s.arc > reach && s.arc < length - reach;
        const bInner = b.points.filter((s) => inner(s, b.length));
        let min = Infinity;
        for (const p of a.points) {
          if (!inner(p, a.length)) continue;
          for (const q of bInner) {
            const plan = Math.hypot(p.point[0] - q.point[0], p.point[1] - q.point[1]);
            if (plan >= reach) continue;
            min = Math.min(min, Math.hypot(plan, p.z - q.z));
          }
        }
        expect(min, `${a.tube.id} × ${b.tube.id}`).toBeGreaterThanOrEqual(reach - 0.05);
      }
    }
  });

  it("公告圖的潛盾範圍在涵蓋範圍內皆有圓管", () => {
    const axes = tubes.map((t) => t.geometry.tube!);
    for (const bore of dortsBores()) {
      const inside = samplesAlong(bore.axis, 1).filter(({ point }) => pointInPolygon(point, UNDERGROUND_RING));
      if (inside.length < 2) continue;
      const covered = inside.filter(({ point }) => axes.some((axis) => projectArc(axis, point).distance <= 3.5));
      expect(covered.length / inside.length, bore.id).toBeGreaterThanOrEqual(0.9);
    }
  });
});
