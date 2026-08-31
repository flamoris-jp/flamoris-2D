export function createBrowserProjectWriter(windowObject = window) {
  const handles = new Map();
  const knownNames = new Set();
  return {
    rememberHandle(fileName, handle) {
      handles.set(fileName, handle);
      knownNames.add(fileName);
    },
    async exists(fileName) {
      return knownNames.has(fileName);
    },
    knownFileNames() {
      return [...knownNames];
    },
    async write({ fileName, contents, allowOverwrite = true, mimeType }) {
      let handle = null;
      if (!allowOverwrite && knownNames.has(fileName)) {
        throw new Error(`${fileName} already exists.`);
      }
      if (typeof windowObject.showSaveFilePicker === "function") {
        handle = handles.get(fileName);
        if (!handle) {
          handle = await windowObject.showSaveFilePicker({
            suggestedName: fileName,
            types: [{
              description: "FLAMORIS 2D Project",
              accept: { [mimeType]: [".fl2d"] },
            }],
          });
          handles.set(handle.name, handle);
        }
        const writable = await handle.createWritable();
        await writable.write(contents);
        await writable.close();
      } else {
        const blob = new Blob([contents], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();
        URL.revokeObjectURL(url);
      }
      const writtenName = handle?.name || fileName;
      knownNames.add(writtenName);
      return { fileName: writtenName };
    },
  };
}
