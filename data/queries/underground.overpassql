/* 臺北車站周邊地下結構：月台、股道、地下街、車站量體。
   範圍：環河北路—新生南路、民生西路—長沙街／凱達格蘭大道。 */
[out:json][timeout:180][bbox:25.0400,121.5050,25.0580,121.5330];
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
  way["building"]["layer"~"^-"];
);
out geom;
