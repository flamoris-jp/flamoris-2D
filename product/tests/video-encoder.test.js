import test from "node:test";
import assert from "node:assert/strict";

import {
  VIDEO_ENCODER_PROFILE,
  assertOfficialFfmpegCapability,
  buildH264MfEncodeArgs,
  ffmpegFrameRate,
  parseFfmpegCapability,
} from "../src/core/video-encoder.js";

test("video encoder profile is Windows Media Foundation H.264 without audio", () => {
  assert.deepEqual(VIDEO_ENCODER_PROFILE, {
    container: "mp4",
    videoCodec: "h264_mf",
    pixelFormat: "yuv420p",
    audio: "disabled",
    overwrite: "reject-existing-output",
  });
});

test("rational FPS is preserved exactly in FFmpeg argv", () => {
  assert.equal(ffmpegFrameRate({ numerator: 60000, denominator: 2002 }), "30000/1001");
  const args = buildH264MfEncodeArgs({
    frameDirectory: "C:/temp/frames",
    outputPath: "C:/exports/shot.mp4",
    frameRate: { numerator: 30000, denominator: 1001 },
    frameCount: 30,
  });
  assert.deepEqual(args, [
    "-hide_banner",
    "-loglevel", "warning",
    "-framerate", "30000/1001",
    "-start_number", "1",
    "-i", "C:/temp/frames/frame_%06d.png",
    "-frames:v", "30",
    "-an",
    "-c:v", "h264_mf",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-n",
    "C:/exports/shot.mp4",
  ]);
  assert.equal(args.includes("libx264"), false);
  assert.equal(args.includes("-y"), false);
});

test("capability parser rejects GPL, nonfree, libx264, and missing h264_mf", () => {
  const safe = parseFfmpegCapability({
    versionText: "ffmpeg version 8.0",
    buildConfText: "configuration: --enable-shared --disable-gpl",
    encodersText: " V..... h264_mf H.264 via MediaFoundation",
  });
  assert.equal(safe.distributionSafe, true);
  assert.doesNotThrow(() => assertOfficialFfmpegCapability(safe));

  for (const flag of ["--enable-gpl", "--enable-nonfree", "--enable-libx264"]) {
    const capability = parseFfmpegCapability({
      versionText: "ffmpeg version 8.0",
      buildConfText: `configuration: ${flag}`,
      encodersText: " V..... h264_mf H.264 via MediaFoundation",
    });
    assert.equal(capability.distributionSafe, false);
    assert.throws(
      () => assertOfficialFfmpegCapability(capability),
      (error) => error.code === "VIDEO_ENCODER_LICENSE_POLICY_REJECTED",
    );
  }

  assert.throws(() => assertOfficialFfmpegCapability(parseFfmpegCapability({
    versionText: "ffmpeg version 8.0",
    buildConfText: "configuration: --enable-shared",
    encodersText: " V..... hevc_mf HEVC via MediaFoundation",
  })), (error) => error.code === "VIDEO_ENCODER_H264_MF_UNAVAILABLE");
});

test("encoder argv rejects invalid paths and frame counts", () => {
  const base = {
    frameDirectory: "C:/temp/frames",
    outputPath: "C:/exports/shot.mp4",
    frameRate: { numerator: 24, denominator: 1 },
    frameCount: 24,
  };
  assert.throws(() => buildH264MfEncodeArgs({ ...base, frameDirectory: "" }), /required/);
  assert.throws(() => buildH264MfEncodeArgs({ ...base, outputPath: "" }), /required/);
  assert.throws(() => buildH264MfEncodeArgs({ ...base, frameCount: 0 }), /positive/);
});
