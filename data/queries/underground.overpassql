/* 臺北車站周邊地下結構：月台、股道、地下街、車站量體。
   範圍為地面與地下兩圈涵蓋範圍的外接矩形加 100 公尺餘裕，
   界外的圖徵由 scripts/fetch-osm.ts 依 src/data/coverage.ts 的地下範圍濾除。 */
[out:json][timeout:600][bbox:25.0294,121.4895,25.0594,121.5395];
(
  way["railway"="platform"];
  way["railway"="rail"];
  way["railway"="subway"];
  way["railway"="station"];
  way["public_transport"="station"];
  way["building"="train_station"];
  way["name"~"地下街"];
  way["shop"="mall"];
  way["amenity"="parking"]["parking"="underground"];
  way["location"="underground"];
  way["building"]["level"~"^-"];
);
out geom;
