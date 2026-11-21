/* 涵蓋範圍內的地面地物：建物、主要道路、橋隧、公園綠地、廣場與水域。
   範圍為地面與地下兩圈涵蓋範圍的外接矩形加 100 公尺餘裕，
   界外的圖徵由 scripts/fetch-osm.ts 依 src/data/coverage.ts 的範圍濾除。 */
[out:json][timeout:600][bbox:25.0294,121.4895,25.0594,121.5395];
(
  way["building"];
  relation["building"]["type"="multipolygon"];
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)(_link)?$"];
  way["highway"]["bridge"="yes"];
  way["highway"]["tunnel"="yes"];
  way["highway"="pedestrian"]["area"="yes"];
  way["place"="square"];
  way["leisure"~"^(park|garden|pitch|playground)$"];
  way["landuse"~"^(grass|forest|cemetery|recreation_ground)$"];
  way["natural"~"^(water|sand|wood|scrub|beach)$"];
  way["waterway"="riverbank"];
  relation["natural"="water"];
  relation["leisure"~"^(park|garden)$"];
  way["historic"="memorial"];
);
out geom;
