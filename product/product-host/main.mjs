#!/usr/bin/env node
import { stdin, stdout, stderr } from "node:process";
import { ControlFrameDecoder, writeControlFrame } from "./protocol.mjs";
import { ProductHostService } from "./session-service.mjs";
import { assertNodeRuntimeCapabilities } from "./runtime-audit.mjs";

assertNodeRuntimeCapabilities();
const service = new ProductHostService();
service.emitDiagnostic = diagnostic => {
  try { stderr.write(`FLAMORIS_DIAGNOSTIC ${JSON.stringify(diagnostic)}\n`); }
  catch { /* Diagnostics must never affect Product Host availability. */ }
};
service.bulkEndpoint = await service.assets.start();
const decoder = new ControlFrameDecoder();
let outputQueue = Promise.resolve();
let controlFailed = false;
const failControlAuthority = () => {
  if (controlFailed) return;
  controlFailed = true;
  service.mcp.revoke();
  service.generation?.cancel();
  service.importJob?.cancel();
  service.shutdownRequested = true;
  process.exitCode = 1;
  stdin.destroy();
};
const write = (messages) => {
  outputQueue = outputQueue.then(async () => {
    for (const message of messages) await writeControlFrame(stdout, message);
  });
  return outputQueue;
};
service.onExternalEvents = async events => {
  try { await write(events); }
  catch (error) { failControlAuthority(); throw error; }
};
stdout.on("error", failControlAuthority);

decoder.on("data", (request) => {
  void service.handle(request).then(async ({ response, events }) => {
    await write([response, ...events]);
    if (service.shutdownRequested) stdin.destroy();
  }).catch(() => {
    stderr.write("[product-host] Control channel failed.\n");
    failControlAuthority();
  });
});

decoder.on("error", (error) => {
  stderr.write("[product-host] Invalid control frame.\n");
  failControlAuthority();
});

stdin.pipe(decoder);
await new Promise((resolve) => stdin.on("close", () => { service.mcp.revoke(); service.generation?.cancel(); service.importJob?.cancel(); resolve(); }));
await service.close();
await outputQueue.catch(() => {});
