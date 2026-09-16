#!/usr/bin/env node
import { stdin, stdout, stderr } from "node:process";
import { ControlFrameDecoder, writeControlFrame } from "./protocol.mjs";
import { ProductHostService } from "./session-service.mjs";
import { assertNodeRuntimeCapabilities } from "./runtime-audit.mjs";

assertNodeRuntimeCapabilities();
const service = new ProductHostService();
service.bulkEndpoint = await service.assets.start();
const decoder = new ControlFrameDecoder();
let outputQueue = Promise.resolve();
const write = (messages) => {
  outputQueue = outputQueue.then(async () => {
    for (const message of messages) await writeControlFrame(stdout, message);
  });
  return outputQueue;
};
service.onExternalEvents = events => write(events);

decoder.on("data", (request) => {
  void service.handle(request).then(async ({ response, events }) => {
    await write([response, ...events]);
    if (service.shutdownRequested) stdin.destroy();
  }).catch(() => {
    stderr.write("[product-host] Control channel failed.\n");
    process.exitCode = 1;
    stdin.destroy();
  });
});

decoder.on("error", (error) => {
  stderr.write("[product-host] Invalid control frame.\n");
  process.exitCode = 1;
  stdin.destroy();
});

stdin.pipe(decoder);
await new Promise((resolve) => stdin.on("close", () => { service.mcp.revoke(); service.generation?.cancel(); service.importJob?.cancel(); resolve(); }));
await service.close();
await outputQueue.catch(() => {});
