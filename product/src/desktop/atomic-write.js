import {
  closeSync,
  fsyncSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  open,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";

function temporaryPath(targetPath) {
  return join(
    dirname(targetPath),
    `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
}

async function targetMode(targetPath) {
  try {
    return (await stat(targetPath)).mode & 0o777;
  } catch (error) {
    if (error.code === "ENOENT") return 0o600;
    throw error;
  }
}

function targetModeSync(targetPath) {
  try {
    return statSync(targetPath).mode & 0o777;
  } catch (error) {
    if (error.code === "ENOENT") return 0o600;
    throw error;
  }
}

export async function atomicWriteFile(
  targetPath,
  contents,
  { replace = rename } = {},
) {
  const tempPath = temporaryPath(targetPath);
  let handle = null;
  try {
    handle = await open(tempPath, "wx", await targetMode(targetPath));
    await handle.writeFile(contents, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = null;
    // Same-directory rename maps to replace-existing on Windows through libuv.
    await replace(tempPath, targetPath);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(tempPath).catch((cleanupError) => {
      if (cleanupError.code !== "ENOENT") error.cleanupError = cleanupError;
    });
    throw error;
  }
}

export function atomicWriteFileSync(
  targetPath,
  contents,
  { replace = renameSync } = {},
) {
  const tempPath = temporaryPath(targetPath);
  let descriptor = null;
  try {
    descriptor = openSync(tempPath, "wx", targetModeSync(targetPath));
    writeFileSync(descriptor, contents, { encoding: "utf8" });
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    replace(tempPath, targetPath);
  } catch (error) {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {}
    }
    try {
      unlinkSync(tempPath);
    } catch (cleanupError) {
      if (cleanupError.code !== "ENOENT") error.cleanupError = cleanupError;
    }
    throw error;
  }
}

export async function exclusiveWriteFile(targetPath, contents) {
  const handle = await open(targetPath, "wx", 0o600);
  let failure = null;
  try {
    await handle.writeFile(contents, { encoding: "utf8" });
    await handle.sync();
  } catch (error) {
    failure = error;
  }
  try {
    await handle.close();
  } catch (error) {
    failure ||= error;
  }
  if (failure) {
    await unlink(targetPath).catch((cleanupError) => {
      if (cleanupError.code !== "ENOENT") failure.cleanupError = cleanupError;
    });
    throw failure;
  }
}
