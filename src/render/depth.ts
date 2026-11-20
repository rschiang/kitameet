/**
 * 地下深度的呈現放大。資料層一律保存真實高程，
 * 僅在建模時經由本模組放大，使樓層間的相對關係在畫面上看得出來。
 */

/** 地下高程的放大係數。 */
export const DEPTH_EXAGGERATION = 1.2;

/** 地下高程放大 1.2 倍，地面以上不變。 */
export function exaggerate(z: number): number {
  return z < 0 ? z * DEPTH_EXAGGERATION : z;
}
