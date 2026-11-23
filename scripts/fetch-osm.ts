/**
 * 從 Overpass API 擷取臺北車站周邊圖資，轉為局部公尺座標後寫入 src/data/osm/。
 * 以 `npm run fetch:osm` 執行（Node 原生型別剝離，無需建置步驟）。
 *
 * 網站執行時不連外；本腳本的產出直接進版控。
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { ORIGIN, toLocal, type Local } from "../src/geo/project.ts";
import { nearestOnPolyline } from "../src/geo/measure.ts";
import {
  OVERGROUND_BOUNDARY,
  OVERGROUND_RING,
  UNDERGROUND_BOUNDARY,
  UNDERGROUND_RING,
  insideRing,
} from "../src/data/coverage.ts";
import type {
  IndoorDataset,
  IndoorFeature,
  IndoorKind,
  OsmDataset,
  OsmFeature,
  OsmKind,
} from "../src/data/osm-types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const USER_AGENT = "kitameet/0.1 (https://github.com/; urban planning study)";

/** 保留的 OSM 標籤；其餘捨棄以控制檔案大小與差異雜訊。 */
const KEPT_TAGS = [
  "railway",
  "gauge",
  "usage",
  "electrified",
  "service",
  "public_transport",
  "building",
  "building:levels",
  "building:part",
  "height",
  "min_height",
  "roof:levels",
  "level",
  "layer",
  "tunnel",
  "bridge",
  "location",
  "highway",
  "shop",
  "amenity",
  "parking",
  "man_made",
  "operator",
  "ref",
  "name",
  "name:en",
  "area",
  "leisure",
  "landuse",
  "natural",
  "water",
  "place",
  "surface",
  "waterway",
  "historic",
];

/** 室內動線資料集保留的標籤。 */
const INDOOR_TAGS = [
  "highway",
  "level",
  "incline",
  "conveying",
  "indoor",
  "name",
  "ref",
  "railway",
  "entrance",
  "amenity",
];

/** 西側地面停車場；輪廓供西地下停車場沿用。 */
const WEST_PARKING_WAY = 204616541;

type OverpassNode = { lat: number; lon: number };
type OverpassMember = { type: string; ref: number; role?: string; geometry?: OverpassNode[] };
type OverpassWay = {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: OverpassNode[];
  members?: OverpassMember[];
  lat?: number;
  lon?: number;
};

function parseLevel(tags: Record<string, string>): number | undefined {
  const raw = tags.level ?? tags.layer;
  if (raw === undefined) return undefined;
  const first = raw.split(/[;:-]/).filter((s) => s !== "")[0];
  const sign = raw.trim().startsWith("-") ? -1 : 1;
  const n = Number(first);
  return Number.isFinite(n) ? sign * Math.abs(n) : undefined;
}

/** 視為綠地的 `leisure` 與 `landuse` 值，以及只取橋隧的人行路線等級。 */
const GREEN_LEISURE: Record<string, true> = {
  park: true,
  garden: true,
  pitch: true,
  playground: true,
};
const GREEN_LANDUSE: Record<string, true> = {
  grass: true,
  forest: true,
  cemetery: true,
  recreation_ground: true,
};
const FOOT_HIGHWAY: Record<string, true> = {
  footway: true,
  steps: true,
  path: true,
  cycleway: true,
};

/**
 * 是否真的在地下。OSM 的 `layer` 僅表示繪圖壓線順序：市區建物為了壓在高架橋下
 * 常標 `layer=-1`，照此判定會把整棟地面建物埋入地下。深度一律看 `location` 與 `level`。
 */
function isUnderground(tags: Record<string, string>): boolean {
  if (tags.location === "underground") return true;
  if (tags.location === "surface") return false;
  const level = Number((tags.level ?? "").split(/[;,]/)[0]);
  return Number.isFinite(level) && level < 0;
}

export function classify(tags: Record<string, string>): OsmKind {
  const name = tags.name ?? "";
  if (tags.railway === "platform") return "platform";
  if (tags.railway === "rail") {
    if (tags.gauge === "1435") return "track-hsr";
    if (tags.gauge === "1067") return "track-tra";
    return name.includes("高速鐵路") ? "track-hsr" : "track-tra";
  }
  if (tags.railway === "subway") return "track-metro";
  if (name.includes("地下街")) return "underground-mall";
  if ((tags.building !== undefined || tags.shop === "mall") && isUnderground(tags)) {
    return "underground-mall";
  }
  // building=train_station、public_transport=station 也出現在一般建物上
  // （華山車站舊站房、臺北轉運站），車站量體一律由 overrides.ts 指定
  if (tags.railway === "station") return "station";
  if (tags.building !== undefined) return "building";
  // 二二八和平紀念碑的面只有 historic 標籤，不另列會在此被當作 other 捨棄
  if (tags.historic === "memorial") return "building";

  // 面狀地物：水域、沙洲、綠地與廣場，一律在道路之前判定
  if (tags.natural === "water" || tags.waterway === "riverbank") return "water";
  if (tags.natural === "sand" || tags.natural === "beach") return "sand";
  // 淡水河的沙洲（中興新洲）在 OSM 標 place=islet；橋墩所在的混凝土小洲不算
  if ((tags.place === "islet" || tags.place === "island") && tags.surface !== "concrete") {
    return "sand";
  }
  if (GREEN_LEISURE[tags.leisure ?? ""]) return "green";
  if (GREEN_LANDUSE[tags.landuse ?? ""]) return "green";
  if (tags.natural === "wood" || tags.natural === "scrub") return "green";
  if (tags.place === "square") return "plaza";
  if (tags.highway === "pedestrian" && tags.area === "yes") return "plaza";

  // 高架與地面的區分在資料層依 bridge／layer 標籤判定，此處不看路名
  if (tags.highway !== undefined) {
    // 人行道網路只取橋隧：整片人行道帶進來會淹沒街廓，且與路面重疊
    if (!FOOT_HIGHWAY[tags.highway]) return "road";
    return tags.bridge !== undefined || tags.tunnel !== undefined ? "footway" : "other";
  }
  if (tags.amenity === "parking") return tags.parking === "underground" ? "underground-mall" : "other";
  return "other";
}

function readBbox(query: string) {
  const m = query.match(/\[bbox:\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\s*\]/);
  if (!m) throw new Error("查詢檔缺少 [bbox:...] 設定");
  return { south: +m[1], west: +m[2], north: +m[3], east: +m[4] };
}

/** 伺服器忙碌（429、502、503）或閘道逾時（504）時以指數退避重試，最後才換下一個端點。 */
async function queryOverpass(query: string): Promise<unknown> {
  let lastError = "";
  for (const endpoint of ENDPOINTS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        const delay = 15_000 * 2 ** (attempt - 1);
        console.error(`等待 ${delay / 1000} 秒後重試 ${endpoint}`);
        await sleep(delay);
      }
      let text: string;
      let status: number;
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "User-Agent": USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(280_000),
        });
        status = res.status;
        text = await res.text();
      } catch (err) {
        lastError = `${endpoint} 連線失敗：${String(err)}`;
        console.error(lastError);
        continue;
      }
      if (status === 429 || status === 502 || status === 503 || status === 504) {
        lastError = `${endpoint} HTTP ${status}：${text.slice(0, 200)}`;
        console.error(lastError);
        continue;
      }
      if (status !== 200) {
        lastError = `${endpoint} HTTP ${status}：${text.slice(0, 200)}`;
        console.error(lastError);
        break;
      }
      try {
        const json = JSON.parse(text) as { elements?: unknown };
        if (!Array.isArray(json.elements)) {
          lastError = `${endpoint} 回應缺少 elements：${text.slice(0, 200)}`;
          console.error(lastError);
          break;
        }
        return json;
      } catch {
        lastError = `${endpoint} 回應非 JSON：${text.slice(0, 200)}`;
        console.error(lastError);
      }
    }
  }
  throw new Error(`Overpass 查詢失敗：${lastError}`);
}

const round = (n: number) => Math.round(n * 100) / 100;

const toPoints = (geometry: OverpassNode[]): Local[] =>
  geometry.map((n) => {
    const [x, y] = toLocal(n.lon, n.lat);
    return [round(x), round(y)] as Local;
  });

/** 多重多邊形外環的端點相接容差（公尺）。 */
const RING_TOLERANCE = 0.5;

const near = (a: Local, b: Local): boolean =>
  Math.abs(a[0] - b[0]) <= RING_TOLERANCE && Math.abs(a[1] - b[1]) <= RING_TOLERANCE;

type RingPart = { ref: number; points: Local[] };
type AssembledRing = { points: Local[]; refs: number[] };

/**
 * 以端點相接將多重多邊形的 `outer` 成員串成封閉環，並記下組成各環的成員 way。
 * 串不成封閉環的成員捨棄並回報，不以未封閉的折線矇混成面。
 */
function assembleRings(parts: RingPart[]): { rings: AssembledRing[]; dropped: number } {
  const pool = parts.filter((p) => p.points.length >= 2);
  const used = new Array<boolean>(pool.length).fill(false);
  const rings: AssembledRing[] = [];
  let dropped = 0;
  for (let i = 0; i < pool.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const chain = [...pool[i].points];
    const refs = [pool[i].ref];
    for (;;) {
      if (near(chain[0], chain[chain.length - 1])) break;
      let extended = false;
      for (let j = 0; j < pool.length; j++) {
        if (used[j]) continue;
        const part = pool[j].points;
        const end = chain[chain.length - 1];
        if (near(end, part[0])) chain.push(...part.slice(1));
        else if (near(end, part[part.length - 1])) chain.push(...part.slice(0, -1).reverse());
        else continue;
        used[j] = true;
        refs.push(pool[j].ref);
        extended = true;
        break;
      }
      if (!extended) break;
    }
    if (chain.length >= 4 && near(chain[0], chain[chain.length - 1])) {
      rings.push({ points: chain.slice(0, -1), refs });
    } else dropped += 1;
  }
  return { rings, dropped };
}

/** 圖徵離涵蓋範圍界線超過此距離且全部頂點在界外者捨棄（公尺）。 */
const COVERAGE_MARGIN = 80;

function withinCoverage(points: Local[], ring: Local[], boundary: Local[]): boolean {
  for (const p of points) {
    if (insideRing(p, ring)) return true;
    if (nearestOnPolyline(p, boundary).distance <= COVERAGE_MARGIN) return true;
  }
  return false;
}

function convert(
  json: { elements: OverpassWay[]; osm3s?: { timestamp_osm_base?: string } },
  bbox: OsmDataset["queryBbox"],
  coverage: { ring: Local[]; boundary: Local[] },
): OsmDataset {
  const features: OsmFeature[] = [];
  const wayFeatures: OsmFeature[] = [];
  /** 建成圖徵並推入 `into`；落在涵蓋範圍外時不推入並回傳 false。 */
  const add = (
    into: OsmFeature[],
    id: string,
    tags: Record<string, string>,
    kind: OsmKind,
    points: Local[],
    asPolygon: boolean,
  ): boolean => {
    if (!withinCoverage(points, coverage.ring, coverage.boundary)) return false;
    const kept: Record<string, string> = {};
    for (const key of KEPT_TAGS) if (tags[key] !== undefined) kept[key] = tags[key];
    const level = parseLevel(tags);
    const feature: OsmFeature = { id, source: "osm", kind, tags: kept };
    if (tags.name !== undefined) feature.name = tags.name;
    if (level !== undefined) feature.level = level;
    if (asPolygon) feature.polygon = points;
    else feature.polyline = points;
    into.push(feature);
    return true;
  };

  // 第一輪只取 way，記下成為圖徵者
  const emitted = new Set<number>();
  for (const el of json.elements) {
    if (el.type !== "way" || !el.geometry || el.geometry.length < 2) continue;
    const tags = el.tags ?? {};
    const kind = classify(tags);
    if (kind === "other") continue;

    const pts = toPoints(el.geometry);
    const first = pts[0];
    const last = pts[pts.length - 1];
    const closed =
      pts.length > 3 && Math.abs(first[0] - last[0]) < 0.02 && Math.abs(first[1] - last[1]) < 0.02;
    const asPolygon = closed || tags.area === "yes";
    const points = asPolygon && closed ? pts.slice(0, -1) : pts;
    if (add(wayFeatures, `way/${el.id}`, tags, kind, points, asPolygon)) emitted.add(el.id);
  }

  // 第二輪的多重多邊形：外環若整圈由已自成圖徵的成員 way 串成，兩者幾何完全重合、
  // 渲染時共面互閃，捨棄該環只留成員
  let brokenRings = 0;
  for (const el of json.elements) {
    if (el.type !== "relation") continue;
    const tags = el.tags ?? {};
    const kind = classify(tags);
    if (kind === "other") continue;

    // 內環（沙洲）捨棄：Feature 不支援孔洞，沙洲另由 natural=sand 的面取得
    const outer = (el.members ?? []).filter(
      (m) => m.type === "way" && (m.role ?? "") === "outer" && m.geometry,
    );
    if (outer.length === 0) continue;
    const { rings, dropped } = assembleRings(
      outer.map((m) => ({ ref: m.ref, points: toPoints(m.geometry as OverpassNode[]) })),
    );
    brokenRings += dropped;
    const kept = rings.filter((ring) => !ring.refs.every((ref) => emitted.has(ref)));
    if (kept.length < rings.length) {
      console.error(`relation/${el.id}：${rings.length - kept.length} 個外環與成員 way 重複，已捨棄`);
    }
    kept.forEach((ring, n) => {
      add(features, `relation/${el.id}${kept.length > 1 ? `/${n}` : ""}`, tags, kind, ring.points, true);
    });
  }
  if (brokenRings > 0) console.error(`${brokenRings} 個多重多邊形的外環串不成封閉環，已捨棄`);
  for (const feature of wayFeatures) features.push(feature);

  features.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    generatedAt: new Date().toISOString(),
    queryBbox: bbox,
    overpassTimestamp: json.osm3s?.timestamp_osm_base ?? null,
    originLatLon: { lat: ORIGIN.lat, lon: ORIGIN.lon },
    features,
  };
}

function classifyIndoor(el: OverpassWay): IndoorKind | null {
  const tags = el.tags ?? {};
  if (el.type === "node") {
    if (tags.highway === "elevator") return "elevator";
    if (tags.railway === "subway_entrance") return "entrance";
    if (tags.entrance === "staircase" && tags.ref !== undefined) return "entrance";
    return null;
  }
  if (el.type !== "way") return null;
  if (el.id === WEST_PARKING_WAY) return "parking";
  if (tags.highway === "steps") return "steps";
  if (tags.highway === "pedestrian" && tags.conveying !== undefined) return "steps";
  if (tags.highway === "corridor" || tags.highway === "footway") return "corridor";
  if (tags.indoor === "room") return "room";
  return null;
}

/** 室內動線：way 之外另收 node（電梯、出入口），標籤與樓層字串原樣保留。 */
function convertIndoor(
  json: { elements: OverpassWay[]; osm3s?: { timestamp_osm_base?: string } },
  bbox: OsmDataset["queryBbox"],
): IndoorDataset {
  const features: IndoorFeature[] = [];
  for (const el of json.elements) {
    const kind = classifyIndoor(el);
    if (kind === null) continue;
    const tags: Record<string, string> = {};
    for (const key of INDOOR_TAGS) {
      const value = el.tags?.[key];
      if (value !== undefined) tags[key] = value;
    }
    const feature: IndoorFeature = { id: `${el.type}/${el.id}`, kind, tags };

    let points: Local[];
    if (el.type === "node") {
      if (el.lat === undefined || el.lon === undefined) continue;
      points = toPoints([{ lat: el.lat, lon: el.lon }]);
      feature.point = points[0];
    } else {
      if (!el.geometry || el.geometry.length < 2) continue;
      points = toPoints(el.geometry);
      if (kind === "room" || kind === "parking") {
        const first = points[0];
        const last = points[points.length - 1];
        const closed =
          points.length > 3 &&
          Math.abs(first[0] - last[0]) < 0.02 &&
          Math.abs(first[1] - last[1]) < 0.02;
        if (!closed) continue;
        points = points.slice(0, -1);
        feature.polygon = points;
      } else feature.polyline = points;
    }
    if (!withinCoverage(points, UNDERGROUND_RING, UNDERGROUND_BOUNDARY)) continue;
    features.push(feature);
  }
  features.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    generatedAt: new Date().toISOString(),
    queryBbox: bbox,
    overpassTimestamp: json.osm3s?.timestamp_osm_base ?? null,
    originLatLon: { lat: ORIGIN.lat, lon: ORIGIN.lon },
    features,
  };
}

async function run(name: string) {
  const query = await readFile(join(ROOT, `data/queries/${name}.overpassql`), "utf8");
  const bbox = readBbox(query);
  const json = (await queryOverpass(query)) as Parameters<typeof convert>[0];

  await mkdir(join(ROOT, "data/cache"), { recursive: true });
  await writeFile(join(ROOT, `data/cache/${name}.json`), JSON.stringify(json), "utf8");

  const dataset =
    name === "indoor"
      ? convertIndoor(json, bbox)
      : convert(
          json,
          bbox,
          name === "underground"
            ? { ring: UNDERGROUND_RING, boundary: UNDERGROUND_BOUNDARY }
            : { ring: OVERGROUND_RING, boundary: OVERGROUND_BOUNDARY },
        );
  const outDir = join(ROOT, "src/data/osm");
  await mkdir(outDir, { recursive: true });
  const tmp = join(outDir, `.${name}.json.tmp`);
  await writeFile(tmp, `${JSON.stringify(dataset, null, 1)}\n`, "utf8");
  await rename(tmp, join(outDir, `${name}.json`));

  const byKind = new Map<string, number>();
  for (const f of dataset.features) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
  console.log(
    `${name}: ${dataset.features.length} 項（${[...byKind]
      .map(([k, v]) => `${k} ${v}`)
      .join("、")}），OSM 時間 ${dataset.overpassTimestamp}`,
  );
}

const ALL = ["underground", "surface", "indoor"];
const names = process.argv.slice(2);
for (const name of names) {
  if (!ALL.includes(name)) throw new Error(`未知的資料集 ${name}`);
}
for (const name of names.length > 0 ? names : ALL) {
  await run(name);
}
