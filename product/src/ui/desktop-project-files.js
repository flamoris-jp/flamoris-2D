function copyArrayBuffer(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

export function desktopFileFromPayload(payload) {
  if (!payload || typeof payload.name !== "string") return null;
  const textContents = typeof payload.contents === "string"
    ? payload.contents
    : null;
  const bytes = payload.bytes ? new Uint8Array(payload.bytes) : null;
  return {
    name: payload.name,
    type: payload.mimeType || "application/octet-stream",
    filePath: payload.filePath || null,
    async text() {
      if (textContents !== null) return textContents;
      return new TextDecoder().decode(bytes || new Uint8Array());
    },
    async arrayBuffer() {
      if (bytes) return copyArrayBuffer(bytes);
      return new TextEncoder().encode(textContents || "").buffer;
    },
  };
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
