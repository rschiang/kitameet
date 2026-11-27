/**
 * 折線與圓管量體沿線的高程：有 `elevations` 者依各頂點高程按弧長內插，
 * 否則自 `base` 線性內插到 `baseEnd`（省略時全段同高）。
 */
import { GROUND_EL, type Feature } from "./schema.ts";

/** 量體沿線的高程函式；`s` 為沿 `polyline ?? tube` 的弧長（公尺）。 */
export function elevationAt(feature: Feature): (s: number) => number {
  const line = feature.geometry.polyline ?? feature.geometry.tube ?? [];
  const cumulative = [0];
  for (let i = 1; i < line.length; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  }
  const total = cumulative[cumulative.length - 1];
  const base = feature.base ?? GROUND_EL;
  const elevations = feature.elevations;
  if (elevations === undefined) {
    const end = feature.baseEnd ?? base;
    return (s) => (total > 0 ? base + ((end - base) * Math.min(Math.max(s, 0), total)) / total : base);
  }
  if (elevations.length !== line.length) throw new Error(`量體 ${feature.id} 的 elevations 長度與頂點數不符`);
  return (s) => {
    if (s <= 0 || line.length < 2) return elevations[0];
    if (s >= total) return elevations[elevations.length - 1];
    // 二分搜尋 s 所在的線段
    let lo = 0;
    let hi = cumulative.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] <= s) lo = mid;
      else hi = mid;
    }
    const span = cumulative[hi] - cumulative[lo];
    const t = span > 0 ? (s - cumulative[lo]) / span : 0;
    return elevations[lo] + (elevations[hi] - elevations[lo]) * t;
  };
}

/** 量體各頂點的高程。 */
export function vertexElevations(feature: Feature): number[] {
  const line = feature.geometry.polyline ?? feature.geometry.tube ?? [];
  if (feature.elevations !== undefined) {
    if (feature.elevations.length !== line.length) throw new Error(`量體 ${feature.id} 的 elevations 長度與頂點數不符`);
    return feature.elevations;
  }
  const at = elevationAt(feature);
  let walked = 0;
  return line.map((p, i) => {
    if (i > 0) walked += Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]);
    return at(walked);
  });
}
