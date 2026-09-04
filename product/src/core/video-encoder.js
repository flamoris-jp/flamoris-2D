import { normalizeFrameRate } from "./temporal.js";

export const VIDEO_ENCODER_PROFILE = Object.freeze({
  container: "mp4",
  videoCodec: "h264_mf",
  pixelFormat: "yuv420p",
  audio: "disabled",
  overwrite: "reject-existing-output",
});

function nonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} is required.`);
  }
  return value;
}

function positiveFrameCount(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError("Video frame count must be a positive safe integer.");
  }
  return value;
}

export function ffmpegFrameRate(frameRate) {
  const normalized = normalizeFrameRate(frameRate);
  return `${normalized.numerator}/${normalized.denominator}`;
}

/**
 * Builds the deterministic FFmpeg argv contract for the Phase 4 Windows video
 * path. The input is the canonical one-based PNG sequence produced by Phase
 * 4-2. h264_mf is intentionally selected instead of libx264.
 */
export function buildH264MfEncodeArgs({
  frameDirectory,
  outputPath,
  frameRate,
  frameCount,
}) {
  const directory = nonEmptyString(frameDirectory, "PNG frame directory");
  const output = nonEmptyString(outputPath, "Video output path");
  const count = positiveFrameCount(frameCount);
  const rate = ffmpegFrameRate(frameRate);
  const pattern = `${directory.replace(/[\\/]$/, "")}/frame_%06d.png`;

  return Object.freeze([
    "-hide_banner",
    "-loglevel", "warning",
    "-framerate", rate,
    "-start_number", "1",
    "-i", pattern,
    "-frames:v", String(count),
    "-an",
    "-c:v", VIDEO_ENCODER_PROFILE.videoCodec,
    "-pix_fmt", VIDEO_ENCODER_PROFILE.pixelFormat,
    "-movflags", "+faststart",
    "-n",
    output,
  ]);
}

export function parseFfmpegCapability({ versionText = "", buildConfText = "", encodersText = "" } = {}) {
  const version = String(versionText);
  const build = String(buildConfText);
  const encoders = String(encodersText);
  const combined = `${version}\n${build}`;
  const flags = Object.freeze({
    gpl: /(?:^|\s)--enable-gpl(?:\s|$)/m.test(combined),
    nonfree: /(?:^|\s)--enable-nonfree(?:\s|$)/m.test(combined),
    libx264: /(?:^|\s)--enable-libx264(?:\s|$)/m.test(combined),
  });
  const h264Mf = /(?:^|\s)h264_mf(?:\s|$)/m.test(encoders);
  return Object.freeze({
    available: Boolean(version.trim()),
    h264Mf,
    flags,
    distributionSafe: Boolean(version.trim()) && h264Mf &&
      !flags.gpl && !flags.nonfree && !flags.libx264,
  });
}

export function assertOfficialFfmpegCapability(capability) {
  if (!capability?.available) {
    const error = new Error("FFmpeg is unavailable.");
    error.code = "VIDEO_ENCODER_UNAVAILABLE";
    throw error;
  }
  if (!capability.h264Mf) {
    const error = new Error("FFmpeg does not provide the required h264_mf encoder.");
    error.code = "VIDEO_ENCODER_H264_MF_UNAVAILABLE";
    throw error;
  }
  if (!capability.distributionSafe) {
    const error = new Error("FFmpeg build is not compatible with the official LGPL-only distribution policy.");
    error.code = "VIDEO_ENCODER_LICENSE_POLICY_REJECTED";
    throw error;
  }
  return capability;
}
