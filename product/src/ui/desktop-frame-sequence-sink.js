export function createDesktopFrameSequenceSink(desktopApi) {
  if (!desktopApi ||
    typeof desktopApi.beginFrameSequenceExport !== "function" ||
    typeof desktopApi.writeFrameSequenceFrame !== "function" ||
    typeof desktopApi.endFrameSequenceExport !== "function") {
    throw new TypeError("Desktop frame sequence export APIs are unavailable.");
  }

  return Object.freeze({
    async begin(request) {
      const result = await desktopApi.beginFrameSequenceExport(request);
      if (!result || result.canceled) return { canceled: true };
      if (result.desktopError) {
        const error = new Error(result.desktopError.message || "Frame sequence destination failed.");
        error.code = result.desktopError.code;
        throw error;
      }
      return Object.freeze({
        sessionId: result.sessionId,
        destination: result.destination || null,
      });
    },

    async write(session, frame) {
      const result = await desktopApi.writeFrameSequenceFrame({
        sessionId: session.sessionId,
        fileName: frame.fileName,
        bytes: frame.bytes,
      });
      if (result?.desktopError) {
        const error = new Error(result.desktopError.message || "Frame write failed.");
        error.code = result.desktopError.code;
        throw error;
      }
      return result;
    },

    async end(session, details) {
      if (!session?.sessionId) return null;
      return desktopApi.endFrameSequenceExport({
        sessionId: session.sessionId,
        ...details,
      });
    },
  });
}
