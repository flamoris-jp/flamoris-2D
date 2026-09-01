export function desktopFileFromPayload(payload) {
  if (!payload || typeof payload.name !== "string") return null;
  const contents = typeof payload.contents === "string"
    ? payload.contents
    : new Uint8Array(payload.bytes || []);
  const file = new File([contents], payload.name, {
    type: payload.mimeType || "application/octet-stream",
  });
  Object.defineProperty(file, "filePath", {
    configurable: false,
    enumerable: true,
    value: payload.filePath || null,
    writable: false,
  });
  return file;
}

export function createDesktopProjectWriter(desktopApi) {
  if (!desktopApi?.writeProject || !desktopApi?.projectFileExists) {
    throw new TypeError("A FLAMORIS Desktop bridge is required.");
  }
  return {
    async exists(fileName) {
      return desktopApi.projectFileExists({ fileName });
    },
    async knownFileNames() {
      return desktopApi.listSiblingProjectFiles();
    },
    async write(request) {
      return desktopApi.writeProject({
        operation: request.operation,
        suggestedName: request.fileName,
        contents: request.contents,
        allowOverwrite: request.allowOverwrite,
      });
    },
  };
}
