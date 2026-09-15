import { parentPort, workerData } from 'node:worker_threads';
import { importNativeSource } from './source-import.mjs';
try { parentPort.postMessage({ result: await importNativeSource(workerData.bytes, workerData.kind, workerData.fileName) }); }
catch (error) { parentPort.postMessage({ error: { message: error.message, code: error.code, details: error.details } }); }
