import "./style.css";
import { buildBaseline } from "./data/scene.ts";
import { Viewer } from "./render/scene.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#viewport");
if (!canvas) throw new Error("找不到 #viewport canvas");

const viewer = new Viewer(canvas);
viewer.onAerialRotate = () => viewer.setViewMode("3d");
viewer.setFeatures(buildBaseline());

declare global {
  interface Window {
    /** 開發期間在主控台檢視場景用；正式建置不掛載。 */
    viewer?: Viewer;
  }
}

if (import.meta.env.DEV) {
  window.viewer = viewer;
}
