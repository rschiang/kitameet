/**
 * 網址永久連結：把目前的視圖、方案、圖層、剖面與相機狀態寫入 location.hash。
 * 參數缺漏或版本不符時一律回到預設值，不拋出例外。
 */
import type { LayerId, LevelId } from "../data/schema.ts";
import type { CameraState } from "../render/scene.ts";
import { LAYER_IDS, LEVEL_IDS, defaultState, type AppState, type ScenarioId } from "./state.ts";
import type { ViewMode } from "./viewMode.ts";

const VERSION = "1";

/** 預設開關狀態；永久連結只記錄與預設不同的圖層。 */
const DEFAULT_LAYERS = defaultState().layers;

const round = (n: number) => Math.round(n * 10) / 10;

export function encodeState(state: AppState): string {
  const params = new URLSearchParams();
  params.set("v", VERSION);
  params.set("m", state.mode);
  params.set("s", state.scenario);

  const layersOff = LAYER_IDS.filter((id) => !state.layers[id] && DEFAULT_LAYERS[id]);
  if (layersOff.length > 0) params.set("loff", layersOff.join(","));
  // 預設關閉的圖層（禁限建範圍）開啟時另記，否則分享出去的連結會把它關掉
  const layersOn = LAYER_IDS.filter((id) => state.layers[id] && !DEFAULT_LAYERS[id]);
  if (layersOn.length > 0) params.set("lon", layersOn.join(","));
  const levelsOff = LEVEL_IDS.filter((id) => !state.levels[id]);
  if (levelsOff.length > 0) params.set("voff", levelsOff.join(","));

  if (state.section.enabled) {
    params.set("sec", `${round(state.section.bearing)},${round(state.section.offset)}`);
  }

  const { position, target, zoom } = state.camera;
  params.set("cam", [...position, ...target, zoom].map(round).join(","));
  return params.toString();
}

function parseCamera(raw: string | null, fallback: CameraState): CameraState {
  if (!raw) return fallback;
  const parts = raw.split(",").map(Number);
  if (parts.length < 6 || parts.some((n) => !Number.isFinite(n))) return fallback;
  return {
    position: [parts[0], parts[1], parts[2]],
    target: [parts[3], parts[4], parts[5]],
    zoom: Number.isFinite(parts[6]) && parts[6] > 0 ? parts[6] : 1,
  };
}

export function decodeState(hash: string): AppState {
  const state = defaultState();
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (params.get("v") !== VERSION) return state;

  const mode = params.get("m");
  if (mode === "3d" || mode === "aerial") state.mode = mode as ViewMode;

  const scenario = params.get("s");
  if (scenario === "status-quo" || scenario === "proposal-b") {
    state.scenario = scenario as ScenarioId;
  }

  for (const id of (params.get("loff") ?? "").split(",")) {
    if (LAYER_IDS.includes(id as LayerId)) state.layers[id as LayerId] = false;
  }
  for (const id of (params.get("lon") ?? "").split(",")) {
    if (LAYER_IDS.includes(id as LayerId)) state.layers[id as LayerId] = true;
  }
  for (const id of (params.get("voff") ?? "").split(",")) {
    if (LEVEL_IDS.includes(id as LevelId)) state.levels[id as LevelId] = false;
  }

  const section = params.get("sec");
  if (section) {
    const [bearing, offset] = section.split(",").map(Number);
    if (Number.isFinite(bearing) && Number.isFinite(offset)) {
      state.section = { enabled: true, bearing, offset };
    }
  }

  state.camera = parseCamera(params.get("cam"), state.camera);
  return state;
}

/** 以 replaceState 更新網址，避免在瀏覽器留下大量歷史紀錄。 */
export function writeHash(state: AppState): void {
  const hash = `#${encodeState(state)}`;
  if (location.hash === hash) return;
  history.replaceState(null, "", hash);
}
