import { describe, expect, it } from "vitest";
import { decodeState, encodeState } from "../src/app/permalink.ts";
import { defaultState } from "../src/app/state.ts";

describe("永久連結", () => {
  it("預設狀態編碼後解析回同一份狀態", () => {
    const state = decodeState("");
    expect(decodeState(`#${encodeState(state)}`)).toEqual(state);
  });

  it("關閉捷運群組、開啟禁限建後往返一致", () => {
    const state = defaultState();
    state.layers.metro = false;
    state.layers.restriction = true;
    state.mode = "aerial";
    state.scenario = "proposal-b";
    state.section = { enabled: true, bearing: 100, offset: -120 };
    const hash = encodeState(state);
    expect(hash).toContain("loff=metro");
    expect(hash).toContain("lon=restriction");
    expect(decodeState(`#${hash}`)).toEqual(state);
  });

  it("舊版 v=1 連結回到預設狀態", () => {
    const state = decodeState("#v=1&m=aerial&voff=B3&loff=metro");
    expect(state.layers).toEqual(defaultState().layers);
    expect(state.mode).toBe("3d");
  });
});
