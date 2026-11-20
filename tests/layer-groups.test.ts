import { describe, expect, it } from "vitest";
import { GROUP_OF_LAYER, LAYER_GROUPS } from "../src/app/layerGroups.ts";
import { LAYER_LABELS, type LayerId } from "../src/data/schema.ts";

const LAYER_IDS = Object.keys(LAYER_LABELS) as LayerId[];

describe("圖層群組", () => {
  it("每個圖層恰好歸入一組，漏掉的圖層會無法由任何開關控制", () => {
    const seen = LAYER_GROUPS.flatMap((group) => group.layers);
    expect([...seen].sort()).toEqual([...LAYER_IDS].sort());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("GROUP_OF_LAYER 對每個圖層都有值", () => {
    for (const id of LAYER_IDS) {
      expect(GROUP_OF_LAYER[id]).toBeDefined();
    }
  });

  it("群組數不超過 4，面板才一眼看得完", () => {
    expect(LAYER_GROUPS.length).toBeLessThanOrEqual(4);
  });
});
