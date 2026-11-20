import {
  Color,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  MeshStandardMaterial,
  type Scene,
  type Side,
} from "three";
import { BACKGROUND } from "./palette.ts";

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
}

const RIM_COLOR = new Color("#ffffff");

export function createPaperMaterial({
  color,
  opacity = 1,
  rim = 0.18,
  side = DoubleSide,
  offset = false,
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

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: rim };
    shader.uniforms.uRimColor = { value: RIM_COLOR };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uRim;
uniform vec3 uRimColor;`,
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
}`,
      );
  };
  material.customProgramCacheKey = () => `paper-${rim}-${offset ? 1 : 0}`;

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
