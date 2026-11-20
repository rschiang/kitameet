import "./style.css";
import { DATA_PROVENANCE, buildBaseline } from "./data/scene.ts";
import type { LayerId, LevelId } from "./data/schema.ts";
import { Viewer } from "./render/scene.ts";
import { applyVisibility } from "./app/layers.ts";
import {
  createLayerPanel,
  createLegendPanel,
  createScenarioPanel,
  createTitlePanel,
  createViewPanel,
} from "./app/panels.ts";
import { createSectionPanel } from "./app/section.ts";
import { decodeState, writeHash } from "./app/permalink.ts";
import type { AppState, ScenarioId, SectionState } from "./app/state.ts";
import type { ViewMode } from "./app/viewMode.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#viewport");
if (!canvas) throw new Error("找不到 #viewport canvas");

const state: AppState = decodeState(location.hash);
const viewer = new Viewer(canvas);

function syncVisibility(): void {
  applyVisibility(viewer.meshes.values(), state, viewer.viewMode);
  viewer.requestRender();
}

function rebuildScene(): void {
  viewer.setFeatures(buildBaseline());
  syncVisibility();
}

function syncPanels(): void {
  layerPanel.sync(state);
  viewPanel.sync(state.mode);
  scenarioPanel.sync(state.scenario);
  sectionPanel.sync(state.section);
}

let hashFrame = 0;
function scheduleHashUpdate(): void {
  if (hashFrame) return;
  hashFrame = requestAnimationFrame(() => {
    hashFrame = 0;
    state.camera = viewer.cameraState();
    writeHash(state);
  });
}

function setMode(mode: ViewMode): void {
  if (state.mode === mode) return;
  state.mode = mode;
  viewer.setViewMode(mode);
  syncVisibility();
  syncPanels();
  scheduleHashUpdate();
}

function setScenario(scenario: ScenarioId): void {
  if (state.scenario === scenario) return;
  state.scenario = scenario;
  rebuildScene();
  syncPanels();
  scheduleHashUpdate();
}

function setLayer(layer: LayerId, visible: boolean): void {
  state.layers[layer] = visible;
  syncVisibility();
  scheduleHashUpdate();
}

function setLevel(level: LevelId, visible: boolean): void {
  state.levels[level] = visible;
  syncVisibility();
  scheduleHashUpdate();
}

function setSection(next: SectionState): void {
  state.section = next;
  viewer.setSection(next.enabled, next.bearing, next.offset);
  sectionPanel.sync(next);
  scheduleHashUpdate();
}

const layerPanel = createLayerPanel(setLayer, setLevel);
const viewPanel = createViewPanel(setMode);
const scenarioPanel = createScenarioPanel(setScenario);
const sectionPanel = createSectionPanel(state.section, setSection);
const provenance = `圖資擷取於 ${DATA_PROVENANCE.overpassTimestamp?.slice(0, 10) ?? "未知日期"}，樓層高程為推估值。`;

document.body.append(
  createTitlePanel(provenance),
  layerPanel.element,
  viewPanel.element,
  scenarioPanel.element,
  sectionPanel.element,
  createLegendPanel(),
);

viewer.onAerialRotate = () => setMode("3d");
viewer.onCameraChange = scheduleHashUpdate;

rebuildScene();
if (state.mode !== viewer.viewMode) viewer.setViewMode(state.mode);
viewer.applyCameraState(state.camera);
viewer.setSection(state.section.enabled, state.section.bearing, state.section.offset);
syncPanels();
writeHash(state);

window.addEventListener("hashchange", () => {
  const next = decodeState(location.hash);
  Object.assign(state, next);
  if (state.mode !== viewer.viewMode) viewer.setViewMode(state.mode);
  rebuildScene();
  viewer.applyCameraState(state.camera);
  viewer.setSection(state.section.enabled, state.section.bearing, state.section.offset);
  syncPanels();
});

declare global {
  interface Window {
    /** 開發期間在主控台檢視場景用；正式建置不掛載。 */
    viewer?: Viewer;
  }
}

if (import.meta.env.DEV) {
  window.viewer = viewer;
}
