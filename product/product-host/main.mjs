#!/usr/bin/env node
import { stdin, stdout, stderr } from "node:process";
import { ControlFrameDecoder, writeControlFrame } from "./protocol.mjs";
import { ProductHostService } from "./session-service.mjs";
import { assertNodeRuntimeCapabilities } from "./runtime-audit.mjs";

assertNodeRuntimeCapabilities();
const service = new ProductHostService();
service.bulkEndpoint = await service.assets.start();
const decoder = new ControlFrameDecoder();
let queue = Promise.resolve();

decoder.on("data", (request) => {
  queue = queue.then(async () => {
    const { response, events } = await service.handle(request);
    await writeControlFrame(stdout, response);
    for (const event of events) await writeControlFrame(stdout, event);
    if (service.shutdownRequested) stdin.destroy();
  }).catch((error) => {
    stderr.write(`[product-host] ${error?.stack || error}\n`);
    process.exitCode = 1;
    stdin.destroy();
  });
});

decoder.on("error", (error) => {
  stderr.write(`[product-host] ${error?.stack || error}\n`);
  process.exitCode = 1;
  stdin.destroy();
});

stdin.pipe(decoder);
await new Promise((resolve) => stdin.on("close", resolve));
await queue;
await service.assets.close();
