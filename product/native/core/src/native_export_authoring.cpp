#include "native_authoring.h"
#include "native_locale.h"
#include "native_render_plan.h"
#include "native_temporal_evaluation.h"
#include "wide_ticks.h"
#include <cmath>
#include <numeric>
#include <regex>
namespace fl2d_authoring {
namespace {
Value profile() {
  return Value(Object{{"container", Value("mp4")},
                      {"videoCodec", Value("h264_mf")},
                      {"pixelFormat", Value("nv12")},
                      {"alphaComposite", Value("black")},
                      {"audio", Value("disabled")},
                      {"overwrite", Value("reject-existing-output")}});
}
Value partial_policy() {
  return Value(Object{{"onCancel", Value("keep-written-frames")},
                      {"onFailure", Value("keep-written-frames")},
                      {"overwrite", Value("reject-existing-output")}});
}
bool safe_positive(const Value &v) {
  return v.is<double>() && std::isfinite(v.get<double>()) &&
         v.get<double>() > 0 && v.get<double>() <= 9007199254740991.0 &&
         std::trunc(v.get<double>()) == v.get<double>();
}
Value normalized_rate(const Value &rate) {
  const auto n = field(rate, "numerator"), d = field(rate, "denominator");
  if (!safe_positive(n) || !safe_positive(d))
    throw fl2d_queries::Error{
        "RangeError",
        "Frame rate numerator and denominator must be positive safe integers."};
  auto gcd = std::gcd(static_cast<uint64_t>(n.get<double>()),
                      static_cast<uint64_t>(d.get<double>()));
  return Value(Object{
      {"numerator", Value(n.get<double>() / static_cast<double>(gcd))},
      {"denominator", Value(d.get<double>() / static_cast<double>(gcd))}});
}
std::string numeric(const Value &v) { return v.serialize(); }
uint64_t dimension(const Value &v, const std::string &title) {
  if (!safe_positive(v))
    throw fl2d_queries::Error{"RangeError",
                              title + " must be a positive safe integer."};
  return static_cast<uint64_t>(v.get<double>());
}
bool token(const std::string &s, const std::string &word) {
  return std::regex_search(s, std::regex("(?:^|\\s)" + word + "(?:\\s|$)"));
}
bool nonblank(const Value &v) {
  if (!v.is<std::string>())
    return false;
  auto units = fl2d_locale::utf16(v.get<std::string>());
  for (auto u : units)
    if (!(u >= 9 && u <= 13) && u != 32 && u != 160 && u != 0x1680 &&
        !(u >= 0x2000 && u <= 0x200a) && u != 0x2028 && u != 0x2029 &&
        u != 0x202f && u != 0x205f && u != 0x3000 && u != 0xfeff)
      return true;
  return false;
}
} // namespace
Value export_settings(const Value &p) {
  const auto canvas = field(p, "canvas"), width = field(canvas, "width"),
             height = field(canvas, "height");
  Array resolutions;
  if (safe_positive(width) && safe_positive(height)) {
    resolutions.emplace_back(Object{
        {"id", Value("project")},
        {"label", Value("Project " + numeric(width) + " × " + numeric(height))},
        {"width", width},
        {"height", height}});
    auto w = static_cast<uint64_t>(number(width)),
         h = static_cast<uint64_t>(number(height));
    if (fl2d_ticks::UInt128(w).times(1080).compare(
            fl2d_ticks::UInt128(h).times(1920)) == 0 &&
        (w != 1920 || h != 1080))
      resolutions.emplace_back(Object{{"id", Value("hd-1080")},
                                      {"label", Value("1920 × 1080")},
                                      {"width", Value(1920.0)},
                                      {"height", Value(1080.0)}});
  }
  resolutions.emplace_back(Object{{"id", Value("custom")},
                                  {"label", Value("Custom")},
                                  {"width", Value()},
                                  {"height", Value()}});
  Array rates;
  for (auto fps : {24, 30, 60})
    rates.emplace_back(
        Object{{"id", Value(std::to_string(fps))},
               {"label", Value(std::to_string(fps) + " fps")},
               {"frameRate",
                Value(Object{{"numerator", Value(static_cast<double>(fps))},
                             {"denominator", Value(1.0)}})}});
  auto render = field(p, "renderSettings"),
       rate = normalized_rate(field(render, "frameRate"));
  bool present = false;
  for (const auto &r : rates)
    if (field(r, "frameRate") == rate)
      present = true;
  if (!present)
    rates.insert(
        rates.begin(),
        Value(
            Object{{"id", Value("project")},
                   {"label",
                    Value("Project " + numeric(field(rate, "numerator")) + "/" +
                          numeric(field(rate, "denominator")) + " fps")},
                   {"frameRate", rate}}));
  rates.emplace_back(Object{{"id", Value("custom")},
                            {"label", Value("Custom rational")},
                            {"frameRate", Value()}});
  return Value(Object{{"resolutions", Value(resolutions)},
                      {"frameRates", Value(rates)},
                      {"renderSettings", render},
                      {"canvas", canvas},
                      {"videoProfile", profile()},
                      {"partialOutputPolicy", partial_policy()}});
}
Value export_plan(const Value &p, const Value &input) {
  const bool sequence = truthy(field(input, "sequenceId")),
             transition = truthy(field(input, "transitionId"));
  if (sequence == transition)
    error("Select exactly one Sequence or Transition for export.");
  auto owner =
      query(p, sequence ? "sequence.get" : "transition.get",
            {{sequence ? "sequenceId" : "transitionId",
              field(input, sequence ? "sequenceId" : "transitionId")}});
  auto plan = fl2d_evaluation::frame_plan(
      static_cast<uint64_t>(number(field(owner, "durationTicks"))),
      field(input, "frameRate"));
  const auto sw = dimension(field(field(p, "canvas"), "width"),
                            "Project canvas width"),
             sh = dimension(field(field(p, "canvas"), "height"),
                            "Project canvas height"),
             w = dimension(field(input, "width"), "Output width"),
             h = dimension(field(input, "height"), "Output height");
  if (fl2d_ticks::UInt128(sw).times(h).compare(
          fl2d_ticks::UInt128(sh).times(w)) != 0)
    throw fl2d_queries::Error{
        "RangeError",
        "Output resolution must preserve the Project canvas aspect ratio; "
        "crop, stretch, and padding are undefined."};
  if (w > 4096 || h > 4096 || w * h > 8294400)
    error("Native export supports up to 8,294,400 pixels, maximum dimension "
          "4096.");
  if (truthy(field(input, "video")) && (w % 2 || h % 2))
    error("H.264 output dimensions must be even.");
  plan.get<Object>()["target"] = Value(
      Object{{"width", field(input, "width")},
             {"height", field(input, "height")},
             {"viewportWidth", field(input, "width")},
             {"viewportHeight", field(input, "height")},
             {"originX", Value(0.0)},
             {"originY", Value(0.0)},
             {"scale", Value(static_cast<double>(w) / static_cast<double>(sw))},
             {"mapping", Value("project-origin-uniform-scale")}});
  plan.get<Object>()["partialOutputPolicy"] = partial_policy();
  return plan;
}
Value export_frame(const Value &p, const Value &input) {
  auto plan = export_plan(p, input),
       frame = fl2d_evaluation::export_frame(plan, field(input, "frameIndex"));
  auto render_input = input;
  render_input.get<Object>()["timeTicks"] = field(frame, "timeTicks");
  render_input.get<Object>()["keyArtId"] = Value();
  auto projection = fl2d_render::projection(p, render_input);
  for (const auto &d : field(projection, "diagnostics").get<Array>())
    if (field(d, "severity") == Value("error"))
      error("Export evaluation contains structural diagnostics.");
  std::ostringstream file;
  file << "frame_" << std::setw(6) << std::setfill('0')
       << static_cast<uint64_t>(number(field(input, "frameIndex"))) + 1
       << ".png";
  projection.get<Object>()["frame"] = frame;
  projection.get<Object>()["fileName"] = Value(file.str());
  projection.get<Object>()["target"] = field(plan, "target");
  return projection;
}
Value encoder_contract(const Value &input) {
  const auto probe = field(input, "probe");
  if (truthy(probe)) {
    auto version = text(field(probe, "versionText")),
         build = text(field(probe, "buildConfText")),
         encoders = text(field(probe, "encodersText")),
         filters = text(field(probe, "filtersText")),
         combined = version + "\n" + build;
    bool available = nonblank(Value(version)),
         h264 = token(encoders, "h264_mf"),
         premultiply = token(filters, "premultiply"),
         gpl = token(combined, "--enable-gpl"),
         nonfree = token(combined, "--enable-nonfree"),
         x264 = token(combined, "--enable-libx264"),
         safe = available && h264 && premultiply && !gpl && !nonfree && !x264;
    if (!available)
      throw fl2d_queries::Error{"VIDEO_ENCODER_UNAVAILABLE",
                                "FFmpeg is unavailable."};
    if (!h264)
      throw fl2d_queries::Error{
          "VIDEO_ENCODER_H264_MF_UNAVAILABLE",
          "FFmpeg does not provide the required h264_mf encoder."};
    if (!premultiply)
      throw fl2d_queries::Error{
          "VIDEO_ENCODER_ALPHA_FILTER_UNAVAILABLE",
          "FFmpeg does not provide the premultiply filter required for "
          "deterministic alpha flattening."};
    if (!safe)
      throw fl2d_queries::Error{"VIDEO_ENCODER_LICENSE_POLICY_REJECTED",
                                "FFmpeg build is not compatible with the "
                                "official LGPL-only distribution policy."};
    return Value(Object{{"available", Value(available)},
                        {"h264Mf", Value(h264)},
                        {"premultiply", Value(premultiply)},
                        {"flags", Value(Object{{"gpl", Value(gpl)},
                                               {"nonfree", Value(nonfree)},
                                               {"libx264", Value(x264)}})},
                        {"distributionSafe", Value(safe)}});
  }
  if (!nonblank(field(input, "frameDirectory")))
    throw fl2d_queries::Error{"TypeError", "PNG frame directory is required."};
  if (!nonblank(field(input, "outputPath")))
    throw fl2d_queries::Error{"TypeError", "Video output path is required."};
  if (!safe_positive(field(input, "frameCount")))
    throw fl2d_queries::Error{
        "RangeError", "Video frame count must be a positive safe integer."};
  auto rate = normalized_rate(field(input, "frameRate"));
  auto directory = text(field(input, "frameDirectory"));
  if (!directory.empty() &&
      (directory.back() == '/' || directory.back() == '\\'))
    directory.pop_back();
  Array arguments;
  for (const auto &v : std::vector<std::string>{
           "-hide_banner",
           "-loglevel",
           "warning",
           "-framerate",
           numeric(field(rate, "numerator")) + "/" +
               numeric(field(rate, "denominator")),
           "-start_number",
           "1",
           "-i",
           directory + "/frame_%06d.png",
           "-frames:v",
           numeric(field(input, "frameCount")),
           "-an",
           "-vf",
           "format=gbrap,premultiply=inplace=1,format=nv12",
           "-c:v",
           "h264_mf",
           "-pix_fmt",
           "nv12",
           "-movflags",
           "+faststart",
           "-n",
           text(field(input, "outputPath"))})
    arguments.emplace_back(v);
  return Value(Object{{"args", Value(arguments)}, {"profile", profile()}});
}
} // namespace fl2d_authoring
