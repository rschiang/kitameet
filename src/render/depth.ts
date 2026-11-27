/**
 * 資料高程（EL）到場景 Y 的換算。資料層一律保存真實高程，
 * 僅在建模時經由本模組換算：場景以地面為 Y = 0，地下部分放大，
 * 使樓層間的相對關係在畫面上看得出來。
 */
import { GROUND_EL } from "../data/schema.ts";

/** 地下深度的放大係數。 */
export const DEPTH_EXAGGERATION = 1.2;

/** EL 換算為場景 Y：地面為 0，地下深度放大 1.2 倍，地面以上不變。 */
export function sceneY(elevation: number): number {
  const offset = elevation - GROUND_EL;
  return offset < 0 ? offset * DEPTH_EXAGGERATION : offset;
}
