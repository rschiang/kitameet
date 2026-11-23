/* 臺北車站 B1 的室內動線：通道、階梯、電扶梯、電梯、出入口與付費區。
   範圍取站內《台北車站周邊地下街 B1 出口資訊》圖幅所及。
   way 204616541 為西側地面停車場，其輪廓供西地下停車場沿用。 */
[out:json][timeout:120][bbox:25.0452,121.5104,25.0512,121.5212];
(
  way["highway"="corridor"]["level"];
  way["highway"="footway"]["level"~"^-"];
  way["highway"="steps"]["level"];
  way["indoor"="room"]["level"="-1"];
  way["highway"="pedestrian"]["conveying"]["level"="-3"];
  way(id:204616541);
  node["highway"="elevator"];
  node["railway"="subway_entrance"];
  node["entrance"="staircase"]["ref"];
);
out geom;
