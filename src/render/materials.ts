import {
  Color,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  MeshStandardMaterial,
  RedFormat,
  UnsignedByteType,
  type Scene,
  type Side,
} from "three";
import { BACKGROUND } from "./palette.ts";

/** 車站特定區內遮蔽臺鐵、高鐵的建物轉為半透明時的不透明度。 */
export const GHOST_OPACITY = 0.7;
/** 其餘遮蔽（特定區外，或只壓到捷運股道與月台）的不透明度；本案以臺鐵、高鐵改線為主，其他遮蔽只要稍微透出即可。 */
export const LIGHT_GHOST_OPACITY = 0.95;
/** 淺淡化的強度，為淡化貼圖的目標值：著色器以 1 → GHOST_OPACITY 線性內插，此值使其落在 LIGHT_GHOST_OPACITY。 */
export const LIGHT_GHOST_LEVEL = (1 - LIGHT_GHOST_OPACITY) / (1 - GHOST_OPACITY);

const FADE_MAP_WIDTH = 256;
const FADE_MAP_HEIGHT = 64;
/** 淡化貼圖可容納的淡化單元數量。 */
export const FADE_MAP_CAPACITY = FADE_MAP_WIDTH * FADE_MAP_HEIGHT;
/** 各淡化單元的淡化程度（0 為實心、255 為完全淡化），索引即單元編號。 */
export const FADE_BYTES = new Uint8Array(FADE_MAP_CAPACITY);
/** 所有遮蔽材質共用的淡化貼圖；寫入 {@link FADE_BYTES} 後需設定 `needsUpdate`。 */
export const FADE_MAP = {
  value: new DataTexture(FADE_BYTES, FADE_MAP_WIDTH, FADE_MAP_HEIGHT, RedFormat, UnsignedByteType),
};
FADE_MAP.value.needsUpdate = true;

/**
 * 遮蔽量體的三道繪製：`solid` 只畫未淡化的單元；`prepass` 只寫入已淡化單元的深度；
 * `veil` 以半透明畫出已淡化單元最靠近相機的一層。
 */
export type OccluderPass = "solid" | "prepass" | "veil";

/**
 * 紙模型材質：啞光卡紙加上菲涅耳邊緣提亮與極淡的垂直漸層，
 * 讓量體邊界在無描邊的情況下仍然分明。
 */
export interface PaperMaterialOptions {
  color: string;
  /** 半透明（用於拆除量體）。 */
  opacity?: number;
  /** 邊緣提亮強度，預設 0.18。 */
  rim?: number;
  /** 只畫背面可做出「掀蓋紙盒」的效果，讓外殼不遮住內部。 */
  side?: Side;
  /**
   * 深度偏移：樓板與站體外殼退讓給貼在它上面的量體，
   * 避免共面造成 z-fighting（月台與樓板、大廳頂與外殼頂互閃）。
   */
  offset?: boolean;
  /** 遮蔽量體的繪製階段；省略時不參與淡化。 */
  occluder?: OccluderPass;
}

const RIM_COLOR = new Color("#ffffff");

export function createPaperMaterial({
  color,
  opacity = 1,
  rim = 0.18,
  side = DoubleSide,
  offset = false,
  occluder,
}: PaperMaterialOptions): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: new Color(color),
    roughness: 0.95,
    metalness: 0,
    flatShading: false,
    side, // 預設 DoubleSide，剖切後可見內部斷面
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
  });
  if (offset) {
    material.polygonOffset = true;
    material.polygonOffsetFactor = 1;
    material.polygonOffsetUnits = 1;
  }
  if (occluder === "prepass") {
    material.transparent = true;
    material.depthWrite = true;
    material.colorWrite = false;
    material.forceSinglePass = true;
  } else if (occluder === "veil") {
    material.transparent = true;
    material.depthWrite = false;
    material.forceSinglePass = true;
  }

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: rim };
    shader.uniforms.uRimColor = { value: RIM_COLOR };
    if (occluder) {
      shader.uniforms.uFadeMap = FADE_MAP;
      // 同一單元的頂點共用淡化值，移出裁切空間即整個單元不繪製
      const culled = occluder === "solid" ? "vFade > 0.0" : "vFade <= 0.0";
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
attribute float occluder;
uniform sampler2D uFadeMap;
varying float vFade;`,
        )
        .replace(
          "#include <project_vertex>",
          `#include <project_vertex>
{
  int unit = int(occluder + 0.5);
  vFade = texelFetch(uFadeMap, ivec2(unit % ${FADE_MAP_WIDTH}, unit / ${FADE_MAP_WIDTH}), 0).r;
  if (${culled}) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`,
        );
    }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uRim;
uniform vec3 uRimColor;${occluder ? "\nvarying float vFade;" : ""}`,
      )
      .replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
{
  vec3 nrm = normalize(vNormal);
  vec3 viewDir = normalize(vViewPosition);
  float fresnel = pow(1.0 - clamp(dot(nrm, viewDir), 0.0, 1.0), 2.5);
  // 垂直方向的極淡漸層：朝上的面略亮，側面略暗
  float vertical = 0.5 + 0.5 * nrm.y;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uRimColor, fresnel * uRim);
  gl_FragColor.rgb *= 0.96 + 0.06 * vertical;
}${occluder === "veil" ? `\ngl_FragColor.a *= mix(1.0, ${GHOST_OPACITY.toFixed(3)}, vFade);` : ""}`,
      );
  };
  material.customProgramCacheKey = () => `paper-${rim}-${offset ? 1 : 0}-${occluder ?? "none"}`;

  return material;
}

/** 場景光照：半球光補地面反射，單一平行光由西南上方入射。 */
export function setupLighting(scene: Scene): void {
  const hemi = new HemisphereLight(0xffffff, 0xcfc6b4, 0.9);
  scene.add(hemi);

  const sun = new DirectionalLight(0xffffff, 1.1);
  sun.position.set(-600, 1000, 400);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = -900;
  cam.right = 900;
  cam.top = 900;
  cam.bottom = -900;
  cam.near = 10;
  cam.far = 3000;
  sun.shadow.bias = -0.0008;
  scene.add(sun);
  scene.add(sun.target);
}

export const BACKGROUND_COLOR = new Color(BACKGROUND);
