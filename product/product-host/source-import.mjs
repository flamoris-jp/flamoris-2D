import { createProjectFromPsd } from '../src/io/psd-project.js';
import { collectPsdParts } from '../src/psd.js';
import { importCutworkFlimg } from '../src/io/cutwork-flimg-project.js';
import { CUTWORK_FLIMG_LIMITS } from '../src/io/cutwork-flimg-reader.js';
import { persistedRgbaAssets, NATIVE_ARTWORK_LIMITS } from './document-artwork.mjs';

export async function importNativeSource(bytes, kind, fileName) {
  if (typeof fileName !== 'string' || !fileName.trim() || fileName.length > 260) throw new Error('Invalid source filename.');
  if (kind === 'flimg') {
    const imported = await importCutworkFlimg(bytes, { fileName, projectName: fileName,
      limits: { ...CUTWORK_FLIMG_LIMITS, maximumRasterWorkingSetBytes: NATIVE_ARTWORK_LIMITS.bytes / 2 } });
    return { project: imported.project, renderAssets: persistedRgbaAssets(imported.renderAssets), diagnostics: imported.result.diagnostics };
  }
  if (kind !== 'psd') throw new Error('Unsupported source format.');
  // This is a Node adapter of the already-pinned Product dependency, not window.agPsd.
  const { readPsd, initializeCanvas } = await import('ag-psd');
  let allocated = 0;
  const imageData = (width, height) => {
    const size = width * height * 4;
    if (![width, height].every(n => Number.isSafeInteger(n) && n > 0 && n <= NATIVE_ARTWORK_LIMITS.dimension) ||
        width * height > NATIVE_ARTWORK_LIMITS.pixels || (allocated += size) > NATIVE_ARTWORK_LIMITS.bytes / 2)
      throw new Error('PSD decode exceeds the native artwork budget.');
    return { width, height, data: new Uint8ClampedArray(size) };
  };
  initializeCanvas(() => { throw new Error('Unexpected canvas decode; useImageData is required.'); }, imageData);
  const psd = readPsd(bytes, { useImageData: true, skipThumbnail: true, skipCompositeImageData: true,
    skipLinkedFilesData: true, totalMemoryLimit: NATIVE_ARTWORK_LIMITS.bytes / 2 });
  let count = 0;
  function adapt(children) {
    for (const layer of children || []) {
      if (++count > NATIVE_ARTWORK_LIMITS.count) throw new Error('PSD has too many layers.');
      if (layer.imageData) {
        const data = layer.imageData;
        // Minimal read-only adapter for existing fingerprint/part collection, never a DOM canvas.
        layer.canvas = { width: data.width, height: data.height,
          getContext: () => ({ getImageData: () => data }) };
      }
      adapt(layer.children);
    }
  }
  adapt(psd.children);
  const project = createProjectFromPsd(psd, { fileName, projectName: fileName });
  const bySource = new Map(Object.values(project.scene.nodes).filter(n => n.sourceRef).map(n => [n.sourceRef.sourceKey, n.id]));
  const records = collectPsdParts(psd.children).filter(p => p.canvas && p.width > 0 && p.height > 0).map(p => {
    const { canvas, mask, ...record } = p;
    return { ...record, nodeId: bySource.get(p.sourceKey), rgba: new Uint8Array(canvas.getContext().getImageData().data) };
  });
  if (!records.length) throw new Error('No raster PSD layers were found.');
  return { project, renderAssets: persistedRgbaAssets(records), diagnostics: [] };
}
