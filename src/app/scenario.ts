/**
 * 方案切換：現況回傳基準量體，方案 B 另外標記拆除、新建與歸還臺鐵的量體。
 * 著色由 {@link Feature.status} 決定，渲染端不需認得方案。
 */
import { buildBaseline } from "../data/scene.ts";
import type { Feature } from "../data/schema.ts";
import { proposalB } from "../data/scenarios/proposal-b.ts";
import type { ScenarioId } from "./state.ts";

export function featuresFor(scenario: ScenarioId): Feature[] {
  const baseline = buildBaseline();
  if (scenario === "status-quo") return baseline;

  const removed = new Set(proposalB.removed);
  const repurposed = new Map(proposalB.repurposed.map((item) => [item.id, item.note]));

  const adjusted = baseline.map((feature): Feature => {
    if (removed.has(feature.id)) {
      return { ...feature, status: "removed", sourceNote: `方案 B 拆除。${feature.sourceNote ?? ""}` };
    }
    const note = repurposed.get(feature.id);
    if (note !== undefined) {
      return { ...feature, status: "repurposed", sourceNote: `方案 B：${note}。${feature.sourceNote ?? ""}` };
    }
    return feature;
  });

  return [...adjusted, ...proposalB.added];
}
