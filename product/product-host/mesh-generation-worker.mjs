import { parentPort, workerData } from "node:worker_threads";
import { generateMeshPreview } from "./mesh-hands-on.mjs";

try {
  const result = generateMeshPreview(workerData.asset, workerData.input);
  if (result.candidate?.positions.length > 20000)
    throw new Error("生成結果が体験版の上限（1万頂点）を超えました。密度を下げてください。");
  parentPort.postMessage({ result });
} catch (error) { parentPort.postMessage({ error: error.message }); }
