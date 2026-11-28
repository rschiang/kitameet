/**
 * 現況與方案場景於第一次取用時才建構，單次需數秒。
 * 在 setup 階段先建好，耗時不落在第一個取用它的測試裡、不計入單則測試的逾時；
 * 搭配 `isolate: false`，同一 worker 的後續測試檔直接沿用。
 */
import { featuresFor } from "../src/app/scenario.ts";

featuresFor("proposal-b");
featuresFor("proposal-c");
