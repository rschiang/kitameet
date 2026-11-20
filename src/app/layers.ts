import type { FeatureUserData } from "../render/builders.ts";
import { GROUP_OF_LAYER } from "./layerGroups.ts";
import type { AppState } from "./state.ts";

/**
 * 依圖層群組開關決定單一量體是否顯示。
 * 空拍模式隱藏地面圖層不在此判斷，改由 {@link Viewer} 以淡出處理。
 */
export function isVisible(data: FeatureUserData, state: AppState): boolean {
  return state.layers[GROUP_OF_LAYER[data.layer]] !== false;
}
