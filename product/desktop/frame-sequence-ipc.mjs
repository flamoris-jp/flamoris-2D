import { DesktopFrameSequenceSessionRegistry } from "../src/desktop/frame-sequence-files.js";

const maximumFrameBytes = 256 * 1024 * 1024;

function desktopError(code, message) {
  return { desktopError: { code, message } };
}

export function registerFrameSequenceIpc({
  ipcMain,
  dialog,
  mainWindow,
  assertTrusted,
  associatedDirectory,
  registry = new DesktopFrameSequenceSessionRegistry(),
}) {
  ipcMain.handle("desktop:begin-frame-sequence-export", async (event, request = {}) => {
    assertTrusted(event);
    const result = await dialog.showOpenDialog(mainWindow(), {
      title: "Select PNG Sequence Destination",
      defaultPath: associatedDirectory(),
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    try {
      return await registry.begin(result.filePaths[0], request);
    } catch (error) {
      return desktopError(
        error?.code === "EXPORT_OUTPUT_CONFLICT"
          ? "EXPORT_OUTPUT_CONFLICT"
          : "EXPORT_DESTINATION_INACCESSIBLE",
        error?.message || String(error),
      );
    }
  });

  ipcMain.handle("desktop:write-frame-sequence-frame", async (event, request = {}) => {
    assertTrusted(event);
    if (!(request.bytes instanceof Uint8Array) ||
      request.bytes.length === 0 || request.bytes.length > maximumFrameBytes) {
      return desktopError("EXPORT_FRAME_BYTES_INVALID", "PNG frame data is invalid or too large.");
    }
    try {
      return await registry.write(String(request.sessionId || ""), {
        fileName: request.fileName,
        bytes: request.bytes,
      });
    } catch (error) {
      return desktopError(
        error?.code === "EEXIST" ? "EEXIST" : "EXPORT_FRAME_WRITE_FAILED",
        error?.message || String(error),
      );
    }
  });

  ipcMain.handle("desktop:end-frame-sequence-export", async (event, request = {}) => {
    assertTrusted(event);
    const result = registry.end(String(request.sessionId || ""));
    return {
      ok: true,
      status: request.status || "unknown",
      ...(result || {}),
    };
  });
}
