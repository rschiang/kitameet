/* 臺北車站特定專用區周遭的地面建物與主要道路。
   範圍較地下結構小，僅涵蓋站體周邊街廓。 */
[out:json][timeout:180][bbox:25.0440,121.5090,25.0530,121.5250];
(
  way["building"];
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)(_link)?$"];
  way["highway"="pedestrian"]["area"="yes"];
);
out geom;
