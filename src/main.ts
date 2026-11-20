import "./style.css";
import { DATA_PROVENANCE } from "./data/scene.ts";
import { Viewer } from "./render/scene.ts";
import { isVisible } from "./app/layers.ts";
import type { LayerGroupId } from "./app/layerGroups.ts";
import { featuresFor } from "./app/scenario.ts";
import {
  createBrandCard,
  createInfoContent,
  createLayerContent,
  createLegendContent,
  createScenarioPanel,
  createViewPanel,
} from "./app/panels.ts";
import { createSectionContent } from "./app/section.ts";
import { createToolbar } from "./app/toolbar.ts";
import { icon } from "./app/icons.ts";
import { decodeState, writeHash } from "./app/permalink.ts";
import { defaultState, type AppState, type ScenarioId, type SectionState } from "./app/state.ts";
import type { ViewMode } from "./app/viewMode.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#viewport");
if (!canvas) throw new Error("找不到 #viewport canvas");

const state: AppState = decodeState(location.hash);
const viewer = new Viewer(canvas);

const DEFAULT_LAYERS = defaultState().layers;

function syncVisibility(): void {
  viewer.setLayerFilter((data) => isVisible(data, state));
}

function rebuildScene(): void {
  viewer.setFeatures(featuresFor(state.scenario));
  syncVisibility();
}

function layersChanged(): boolean {
  return (Object.keys(DEFAULT_LAYERS) as LayerGroupId[]).some(
    (id) => state.layers[id] !== DEFAULT_LAYERS[id],
  );
}

function syncPanels(): void {
  layerContent.sync(state);
  viewPanel.sync(state.mode);
  scenarioPanel.sync(state.scenario);
  sectionContent.sync(state.section);
  layersPopover.setMarked(layersChanged());
  sectionPopover.setMarked(state.section.enabled);
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

function setLayerGroup(group: LayerGroupId, visible: boolean): void {
  state.layers[group] = visible;
  syncVisibility();
  syncPanels();
  scheduleHashUpdate();
}

function resetLayerGroups(): void {
  state.layers = defaultState().layers;
  syncVisibility();
  syncPanels();
  scheduleHashUpdate();
}

function setSection(next: SectionState): void {
  state.section = next;
  viewer.setSection(next.enabled, next.bearing, next.offset);
  sectionContent.sync(next);
  sectionPopover.setMarked(next.enabled);
  scheduleHashUpdate();
}

const viewPanel = createViewPanel(setMode);
const scenarioPanel = createScenarioPanel(setScenario);
const provenance = `圖資擷取於 ${DATA_PROVENANCE.overpassTimestamp?.slice(0, 10) ?? "未知日期"}，樓層高程為推估值。`;

const toolbar = createToolbar();
const layerContent = createLayerContent(setLayerGroup, resetLayerGroups);
const layersPopover = toolbar.add({
  id: "layers",
  label: "圖層",
  icon: icon("layers"),
  content: layerContent.element,
});
const sectionContent = createSectionContent(state.section, setSection);
const sectionPopover = toolbar.add({
  id: "section",
  label: "剖面",
  icon: icon("slice"),
  content: sectionContent.element,
});
toolbar.add({ id: "legend", label: "圖例", icon: icon("legend"), content: createLegendContent() });
toolbar.add({ id: "info", label: "資訊", icon: icon("info"), content: createInfoContent(provenance) });

document.body.append(createBrandCard(), scenarioPanel.element, toolbar.element, viewPanel.element);

viewer.onAerialRotate = () => setMode("3d");
viewer.onCameraChange = scheduleHashUpdate;

if (state.mode !== viewer.viewMode) viewer.setViewMode(state.mode);
rebuildScene();
viewer.applyCameraState(state.camera);
viewer.settle();
viewer.setSection(state.section.enabled, state.section.bearing, state.section.offset);
syncPanels();
writeHash(state);

window.addEventListener("hashchange", () => {
  const next = decodeState(location.hash);
  Object.assign(state, next);
  if (state.mode !== viewer.viewMode) viewer.setViewMode(state.mode);
  rebuildScene();
  viewer.applyCameraState(state.camera);
  viewer.settle();
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
