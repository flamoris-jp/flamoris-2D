export function createCutworkRenderAssets(records, {
  createCanvas = (width, height) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
} = {}) {
  if (!Array.isArray(records)) throw new TypeError("Cutwork render assets must be an array.");
  return records.map((record) => {
    if (!(record.rgba instanceof Uint8Array) ||
      record.rgba.length !== record.width * record.height * 4) {
      throw new TypeError(`Cutwork render asset ${record.sourceKey || "(unknown)"} is incomplete.`);
    }
    const canvas = createCanvas(record.width, record.height);
    const context = canvas?.getContext?.("2d");
    if (!context?.createImageData || !context?.putImageData) {
      throw new Error("A 2D canvas is required to materialize Cutwork artwork.");
    }
    const image = context.createImageData(record.width, record.height);
    image.data.set(record.rgba);
    context.putImageData(image, 0, 0);
    const { rgba: _rgba, ...part } = record;
    return { ...part, canvas };
  });
}
