import type { Mesh } from "three";
import type { FeatureUserData } from "../render/builders.ts";
import { AERIAL_HIDDEN_LAYERS, type ViewMode } from "./viewMode.ts";
import type { AppState } from "./state.ts";

/**
 * 依圖層、樓層開關與視圖模式決定單一量體是否顯示。
 * 空拍模式一律隱藏地面以上的圖層。
 */
export function isVisible(data: FeatureUserData, state: AppState, mode: ViewMode): boolean {
  if (mode === "aerial" && AERIAL_HIDDEN_LAYERS[data.layer]) return false;
  return state.layers[data.layer] !== false && state.levels[data.level] !== false;
}

/** 套用目前的開關狀態到所有量體。 */
export function applyVisibility(
  meshes: Iterable<Mesh>,
  state: AppState,
  mode: ViewMode,
): void {
  for (const mesh of meshes) {
    mesh.visible = isVisible(mesh.userData as FeatureUserData, state, mode);
  }
}
