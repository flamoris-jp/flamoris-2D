#include "js_text.h"
#include "native_authoring.h"
#include "native_temporal_evaluation.h"
#include "wide_ticks.h"
#include <algorithm>
#include <cmath>
#include <iomanip>
#include <numeric>
#include <sstream>

namespace fl2d_authoring {
namespace {
const Value &definitions() {
  static const auto value = [] {
    Value v;
    const auto issue = picojson::parse(v, std::string(
#include "native_timeline_definitions.inc"
                                              ));
    if (!issue.empty())
      throw std::logic_error("Invalid native temporal authoring contracts.");
    return v;
  }();
  return value;
}
bool safe(const Value &v) {
  return v.is<double>() && std::isfinite(v.get<double>()) &&
         std::trunc(v.get<double>()) == v.get<double>() &&
         std::abs(v.get<double>()) <= 9007199254740991.0;
}
void range_error(const std::string &message) {
  throw fl2d_queries::Error{"RangeError", message};
}
Value merge(Value value, const Value &patch) {
  if (!value.is<Object>())
    value = Value(Object{});
  if (patch.is<Object>())
    for (const auto &item : patch.get<Object>())
      value.get<Object>()[item.first] = item.second;
  return value;
}
Value stored_owner(Value owner) {
  if (owner.is<Object>())
    owner.get<Object>().erase("durationTicks");
  return owner;
}
Value by(const Value &list, const Value &id, const char *key) {
  if (list.is<Array>())
    for (const auto &item : list.get<Array>())
      if (field(item, key) == id)
        return item;
  return Value();
}
Value channel(const Value &track, const Value &name) {
  return field(
      field(field(definitions(), "channels"), text(field(track, "kind"))),
      text(name));
}
Array allowed(const std::string &owner) {
  auto v = field(field(definitions(), "owners"), owner);
  return v.is<Array>() ? v.get<Array>() : Array{};
}
Value ease(const Value &preset) {
  auto value = field(field(definitions(), "easePresets"), text(preset));
  if (!value.is<Object>())
    error("Unknown ease preset " + text(preset) + ".");
  return merge(Value(Object{{"kind", Value("bezier")}}),
               field(value, "bezier"));
}
Value interpolation(const Value &kind, const Value &controls) {
  auto name = text(kind);
  if (name == "linear" || name == "step")
    return Value(Object{{"kind", kind}});
  if (name != "bezier")
    error("Unknown interpolation " + name + ".");
  Object result{{"kind", kind}};
  for (auto key : {"x1", "y1", "x2", "y2"})
    result[key] = field(controls, key);
  return Value(result);
}
Value duration(const Value &input) {
  const auto &seconds = field(input, "durationSeconds");
  if (!input.is<Object>() || !input.get<Object>().count("durationSeconds"))
    return field(input, "durationTicks");
  if (!seconds.is<double>() || !std::isfinite(seconds.get<double>()) ||
      seconds.get<double>() < 0)
    range_error("Seconds must be a non-negative finite number.");
  auto ticks = Value(std::floor(seconds.get<double>() * 120000 + .5));
  if (!safe(ticks))
    range_error("Tick value exceeds the safe integer range.");
  return ticks;
}
Value rate(const Value &value) {
  const auto &n = field(value, "numerator"), &d = field(value, "denominator");
  if (!safe(n) || !safe(d) || n.get<double>() <= 0 || d.get<double>() <= 0)
    range_error("Playback rate requires positive safe-integer numerator and "
                "denominator.");
  auto divisor = std::gcd(static_cast<uint64_t>(n.get<double>()),
                          static_cast<uint64_t>(d.get<double>()));
  return Value(Object{
      {"numerator", Value(n.get<double>() / static_cast<double>(divisor))},
      {"denominator", Value(d.get<double>() / static_cast<double>(divisor))}});
}
Value default_value(const Value &definition, const Value &input) {
  auto kind = text(field(definition, "value"));
  if (kind == "positive-number" || kind == "unit-number")
    return Value(1.0);
  if (kind == "presence")
    return Value("present");
  if (kind == "clipping")
    return Value(Object{{"sourceNodeId", Value()}});
  if (kind == "deformation") {
    if (!truthy(field(input, "deformationSampleId")))
      error("Choose a compatible MeshDeformationSample before adding this "
            "keyframe.");
    return Value(
        Object{{"deformationSampleId", field(input, "deformationSampleId")},
               {"weight", Value(1.0)}});
  }
  return Value(0.0);
}
std::string label(const Value &target, bool transition = false) {
  if (transition) {
    if (field(target, "transitionDefault") == Value(true))
      return "transition-default";
    if (truthy(field(target, "semanticSlotId")))
      return "SemanticSlot · " + text(field(target, "semanticSlotId"));
    if (truthy(field(target, "nodeId")))
      return "Node · " + text(field(target, "nodeId"));
    return "unsupported target";
  }
  if (truthy(field(target, "cameraId")))
    return "Camera · main";
  for (const auto &entry :
       {std::make_pair("semanticSlotId", "SemanticSlot"),
        std::make_pair("nodeId", "Node"), std::make_pair("boneId", "Bone"),
        std::make_pair("meshId", "Mesh")})
    if (truthy(field(target, entry.first)))
      return std::string(entry.second) + " · " +
             text(field(target, entry.first));
  if (truthy(field(target, "deformerId")))
    return "Deformer · " + text(field(target, "deformerId")) + " / " +
           text(field(target, "controlPointId"));
  return "Unknown target";
}
struct Context {
  Value sequence, clip, transition, owner, program, track, keyframe,
      key_selection;
  double ticks = 0;
  std::string owner_kind;
  Context(const Value &p, const Value &context) {
    if (truthy(field(context, "transitionId"))) {
      transition = query(p, "transition.get",
                         {{"transitionId", field(context, "transitionId")}});
      owner = transition;
      owner_kind = "Transition";
    } else {
      if (truthy(field(context, "sequenceId"))) {
        sequence = query(p, "sequence.get",
                         {{"sequenceId", field(context, "sequenceId")}});
        owner = sequence;
        owner_kind = "Sequence";
      }
      const auto clips = query(p, "animation.clip.list");
      if (truthy(field(context, "clipId"))) {
        clip = find(clips, field(context, "clipId"));
        if (clip.is<Object>()) {
          clip = query(p, "animation.clip.get",
                       {{"clipId", field(context, "clipId")}});
          owner = clip;
          owner_kind = "AnimationClip";
        }
      }
    }
    if (owner.is<Object>()) {
      program = query(p, "animation.get_program",
                      {{"programId", field(owner, "temporalProgramId")}});
      track =
          by(field(program, "tracks"), field(context, "trackId"), "trackId");
    }
    if (sequence.is<Object>() || transition.is<Object>()) {
      auto tick = truthy(field(context, "timeTicks"))
                      ? field(context, "timeTicks")
                      : Value(0.0);
      if (!safe(tick))
        range_error(transition.is<Object>()
                        ? "Preview tick must be a safe integer."
                        : "Timeline tick must be a safe integer.");
      ticks =
          std::clamp(tick.get<double>(), 0.0,
                     number(field(sequence.is<Object>() ? sequence : program,
                                  "durationTicks")));
    }
    if (!transition.is<Object>() && track.is<Object>() &&
        truthy(field(context, "channel")) &&
        truthy(field(context, "keyframeId"))) {
      keyframe = find(field(field(field(track, "channels"),
                                  text(field(context, "channel"))),
                            "keyframes"),
                      field(context, "keyframeId"));
      if (keyframe.is<Object>())
        key_selection =
            Value(Object{{"trackId", field(track, "trackId")},
                         {"channel", field(context, "channel")},
                         {"keyframeId", field(context, "keyframeId")}});
    }
  }
};
Array sorted_items(Array items) {
  std::stable_sort(items.begin(), items.end(),
                   [](const Value &a, const Value &b) {
                     double x = number(field(a, "startTicks")),
                            y = number(field(b, "startTicks"));
                     if (x != y)
                       return x < y;
                     x = number(field(a, "endTicks"));
                     y = number(field(b, "endTicks"));
                     return x != y ? x < y
                                   : fl2d_text::less(text(field(a, "id")),
                                                     text(field(b, "id")));
                   });
  return items;
}
Value view_plan(const Value &sequence, Array next, const std::string &name) {
  next = sorted_items(next);
  if (next.empty())
    error("ViewLane must contain at least one item.");
  if (field(next.front(), "startTicks") != Value(0.0))
    error("ViewLane must start at tick 0.");
  const auto d = number(field(sequence, "durationTicks"));
  for (size_t i = 0; i < next.size(); ++i) {
    const auto &a = field(next[i], "startTicks"),
               &b = field(next[i], "endTicks");
    if (!safe(a) || !safe(b) || a.get<double>() < 0 ||
        a.get<double>() >= b.get<double>() || b.get<double>() > d)
      error("ViewLane item " + text(field(next[i], "id")) +
            " must have a positive in-range duration.");
    if (i && field(next[i - 1], "endTicks") != a)
      error("ViewLane items must remain contiguous without gaps or overlap.");
  }
  if (number(field(next.back(), "endTicks")) != d)
    error("ViewLane must end at the Sequence duration.");
  const auto &before = field(sequence, "viewLaneItems");
  Array commands;
  const auto &id = field(sequence, "id");
  for (const auto &item : sorted_items(before.get<Array>()))
    if (!find(Value(next), field(item, "id")).is<Object>())
      commands.push_back(
          command("sequence.remove_view_item",
                  {{"sequenceId", id}, {"viewItemId", field(item, "id")}}));
  for (const auto &item : next) {
    const auto previous = find(before, field(item, "id"));
    if (!previous.is<Object>())
      commands.push_back(command("sequence.add_view_item",
                                 {{"sequenceId", id}, {"viewItem", item}}));
    else if (previous != item)
      commands.push_back(command("sequence.update_view_item",
                                 {{"sequenceId", id},
                                  {"viewItemId", field(item, "id")},
                                  {"viewItem", item}}));
  }
  return plan(commands, commands.empty() ? "" : name);
}
Array targets(const Value &p, const std::string &kind,
              bool transition = false) {
  Array result;
  auto option = [&](const std::string &title, const Object &target) {
    result.emplace_back(
        Object{{"label", Value(title)}, {"target", Value(target)}});
  };
  if (transition) {
    const auto slots = query(p, "semantic_slot.list");
    if (kind != "GeometryBlendTrack" && kind != "AppearanceTrack")
      option("遷移全体", {{"transitionDefault", Value(true)}});
    for (const auto &s : slots.get<Array>())
      option(text(field(s, "displayName")),
             {{"semanticSlotId", field(s, "id")}});
    if (kind != "GeometryBlendTrack" && kind != "AppearanceTrack")
      for (const auto &key :
           field(field(p, "scene"), "nodes").get<Object>().keys()) {
        const auto &n = field(field(field(p, "scene"), "nodes"), key);
        if (field(n, "kind") == Value("part"))
          option(text(field(n, "displayName")), {{"nodeId", field(n, "id")}});
      }
    return result;
  }
  if (kind == "CameraTrack") {
    option("Main camera", {{"cameraId", Value("main")}});
    return result;
  }
  if (kind == "BoneTrack" || kind == "MeshDeformationTrack") {
    auto values = query(p, kind == "BoneTrack" ? "bone.list" : "mesh.list");
    for (const auto &v : values.get<Array>()) {
      auto id = text(field(v, "id")), name = text(field(v, "displayName"));
      option(name.empty() ? id : name + " · " + id,
             {{kind == "BoneTrack" ? "boneId" : "meshId", field(v, "id")}});
    }
    return result;
  }
  if (kind == "DeformerTrack") {
    auto values = query(p, "deformer.list");
    for (const auto &d : values.get<Array>()) {
      auto full = query(p, "deformer.get", {{"deformerId", field(d, "id")}});
      for (const auto &cp : field(full, "controlPoints").get<Array>())
        option(text(field(d, "id")) + " · " + text(field(cp, "id")),
               {{"deformerId", field(d, "id")},
                {"controlPointId", field(cp, "id")}});
    }
    return result;
  }
  auto nodes = query(p, "scene.search",
                     {{"text", Value("")}, {"includeHidden", Value(true)}})
                   .get<Array>();
  std::sort(nodes.begin(), nodes.end(), [](const Value &a, const Value &b) {
    return fl2d_text::less(text(field(a, "id")), text(field(b, "id")));
  });
  const bool local = kind == "TransformTrack";
  for (const auto &n : nodes) {
    Object t{{"nodeId", field(n, "id")}};
    if (local)
      t["coordinateSpace"] = Value("node-local");
    option("Node · " + text(field(n, "displayName")) + " · " +
               text(field(n, "id")),
           t);
  }
  const auto slots = query(p, "semantic_slot.list");
  for (const auto &s : slots.get<Array>()) {
    Object t{{"semanticSlotId", field(s, "id")}};
    if (local)
      t["coordinateSpace"] = Value("node-local");
    option("SemanticSlot · " + text(field(s, "displayName")) + " · " +
               text(field(s, "id")),
           t);
  }
  return result;
}
Value key_command(const Context &c, const std::string &tool, const Value &input,
                  Ids &ids) {
  const bool transition = c.transition.is<Object>();
  const auto &program = c.program, &track_id = field(input, "trackId"),
             &channel_id = field(input, "channel"),
             &key_id = field(input, "keyframeId");
  const auto track = by(field(program, "tracks"), track_id, "trackId");
  auto definition = channel(track, channel_id);
  const auto previous = find(
      field(field(field(track, "channels"), text(channel_id)), "keyframes"),
      key_id);
  const auto program_id = field(program, "id");
  if (tool == "track.remove") {
    if (!transition && (!program.is<Object>() || !truthy(track_id)))
      error("Select a track first.");
    return plan({command("animation.temporal.remove_track",
                         {{"programId", program_id}, {"trackId", track_id}})},
                transition ? "Edit" : "Remove Animation track");
  }
  if (tool == "key.add") {
    if (transition && !track.is<Object>())
      error("Unknown Transition track.");
    if (!transition && !definition.is<Object>())
      error("Unknown typed channel " + text(channel_id) + ".");
    const auto id = !transition && input.is<Object>() &&
                            input.get<Object>().count("keyframeId")
                        ? field(input, "keyframeId")
                        : ids.next(transition ? "key" : "keyframe");
    auto value = field(input, "value");
    if (!transition &&
        (!input.is<Object>() || !input.get<Object>().count("value")))
      value = default_value(definition, input);
    auto kind = truthy(field(definition, "discrete")) ? Value("step")
                : transition                          ? Value("linear")
                : truthy(field(input, "interpolationKind"))
                    ? field(input, "interpolationKind")
                    : Value("linear");
    auto frame = Value(Object{
        {"id", id},
        {"timeTicks",
         input.is<Object>() && input.get<Object>().count("timeTicks")
             ? field(input, "timeTicks")
             : Value(c.ticks)},
        {"value", value},
        {"interpolationToNext", interpolation(kind, field(input, "bezier"))}});
    return plan(
        {command("animation.temporal.add_keyframe", {{"programId", program_id},
                                                     {"trackId", track_id},
                                                     {"channel", channel_id},
                                                     {"keyframe", frame}})},
        transition ? "Add Transition keyframe" : "Add Animation keyframe",
        {{"keyframeId", id}});
  }
  if (tool == "key.remove") {
    if (!program.is<Object>())
      error("Choose a program first.");
    return plan({command("animation.temporal.remove_keyframe",
                         {{"programId", program_id},
                          {"trackId", track_id},
                          {"channel", channel_id},
                          {"keyframeId", key_id}})},
                transition ? "Remove Transition keyframe"
                           : "Remove Animation keyframe");
  }
  if (!previous.is<Object>())
    error(transition ? "Unknown Transition keyframe."
                     : "Unknown keyframe " + text(key_id) + ".");
  auto frame = previous;
  std::string name =
      transition ? "Update Transition keyframe" : "Update Animation keyframe";
  if (tool == "key.update")
    frame = merge(frame, field(input, "patch"));
  else if (tool == "key.ease") {
    if (!transition) {
      if (!definition.is<Object>())
        error("Unknown typed channel " + text(channel_id) + ".");
      if (truthy(field(definition, "discrete")))
        error("Ease presets apply only to continuous channels.");
      name = "Apply ease preset";
    }
    frame.get<Object>()["interpolationToNext"] = ease(field(input, "presetId"));
  } else if (tool == "key.interpolation") {
    frame.get<Object>()["interpolationToNext"] =
        interpolation(field(input, "kind"), field(input, "controls"));
    if (!transition)
      name = "Set keyframe interpolation";
  } else
    error(transition ? "This tool requires a Sequence or Clip."
                     : "Unknown native timeline tool.");
  frame.get<Object>()["id"] = key_id;
  return plan(
      {command("animation.temporal.update_keyframe", {{"programId", program_id},
                                                      {"trackId", track_id},
                                                      {"channel", channel_id},
                                                      {"keyframeId", key_id},
                                                      {"keyframe", frame}})},
      name);
}
} // namespace
Value timeline_tool(const Value &p, const Value &request) {
  auto context = field(request, "context"), input = field(request, "input");
  const auto tool = text(field(request, "tool"));
  if (truthy(field(context, "transitionId")) && tool.rfind("sequence.", 0) == 0)
    context.get<Object>().erase("transitionId");
  Context c(p, context);
  Ids ids(request);
  auto allocated = [&](const char *key, const char *kind) {
    return input.is<Object>() && input.get<Object>().count(key)
               ? field(input, key)
               : ids.next(kind);
  };
  const auto &sequence = c.sequence;
  const auto &clip = c.clip;
  const auto sequence_id = field(sequence, "id");
  if (tool == "sequence.create") {
    auto id = allocated("sequenceId", "sequence"),
         program = allocated("programId", "program"),
         view = allocated("viewItemId", "view"), d = duration(input),
         art = field(input, "keyArtId");
    query(p, "keyart.get", {{"keyArtId", art}});
    return plan(
        {command("animation.temporal.create_program",
                 {{"programId", program}, {"durationTicks", d}}),
         command("sequence.create",
                 {{"sequence",
                   Value(Object{
                       {"id", id},
                       {"displayName", field(input, "displayName")},
                       {"temporalProgramId", program},
                       {"viewLaneItems",
                        Value(Array{Value(Object{{"id", view},
                                                 {"kind", Value("KeyArtHold")},
                                                 {"keyArtId", art},
                                                 {"startTicks", Value(0.0)},
                                                 {"endTicks", d}})})},
                       {"clipInstances", Value(Array{})},
                       {"metadata", Value(Object{})}})}})},
        "Create Sequence",
        {{"sequenceId", id}, {"programId", program}, {"viewItemId", view}});
  }
  if (c.transition.is<Object>() && tool != "track.add")
    return key_command(c, tool, input, ids);
  if (tool.rfind("sequence.", 0) == 0) {
    if (!sequence.is<Object>())
      error("Select a Sequence first.");
    if (tool == "sequence.rename")
      return plan(
          {command("sequence.update",
                   {{"sequenceId", sequence_id},
                    {"sequence",
                     merge(stored_owner(sequence),
                           Value(Object{{"displayName",
                                         field(input, "displayName")}}))}})},
          "Rename Sequence");
    if (tool == "sequence.remove")
      return plan(
          {command("sequence.remove", {{"sequenceId", sequence_id}}),
           command("animation.temporal.remove_program",
                   {{"programId", field(sequence, "temporalProgramId")}})},
          "Remove Sequence");
    if (tool == "sequence.duration") {
      auto d = duration(input);
      if (!safe(d) || d.get<double>() <= 0)
        range_error("Sequence duration must be a positive integer tick.");
      auto items = sorted_items(field(sequence, "viewLaneItems").get<Array>());
      if (items.empty() ||
          d.get<double>() <= number(field(items.back(), "startTicks")))
        error(
            "Sequence duration must remain after the last ViewLane boundary.");
      auto last = merge(items.back(), Value(Object{{"endTicks", d}}));
      return plan({command("animation.temporal.set_duration",
                           {{"programId", field(sequence, "temporalProgramId")},
                            {"durationTicks", d}}),
                   command("sequence.update_view_item",
                           {{"sequenceId", sequence_id},
                            {"viewItemId", field(last, "id")},
                            {"viewItem", last}})},
                  "Set Sequence duration");
    }
  }
  if (tool.rfind("view.", 0) == 0) {
    Array items =
        sequence.is<Object>()
            ? sorted_items(field(sequence, "viewLaneItems").get<Array>())
            : Array{};
    auto index = items.size();
    for (size_t i = 0; i < items.size(); ++i)
      if (field(items[i], "id") == field(input, "itemId"))
        index = i;
    if (tool == "view.hold" || tool == "view.transition") {
      const auto id = allocated("itemId", "view"),
                 start = field(input, "startTicks"),
                 end = field(input, "endTicks");
      if (!sequence.is<Object>())
        error("Select a Sequence first.");
      const bool transition = tool == "view.transition";
      Value reference =
          query(p, transition ? "transition.get" : "keyart.get",
                {{transition ? "transitionId" : "keyArtId",
                  field(input, transition ? "transitionId" : "keyArtId")}});
      auto containing = items.size();
      for (size_t i = 0; i < items.size(); ++i)
        if (field(items[i], "kind") == Value("KeyArtHold") &&
            start.is<double>() && end.is<double>() &&
            number(field(items[i], "startTicks")) <= start.get<double>() &&
            number(field(items[i], "endTicks")) >= end.get<double>()) {
          containing = i;
          break;
        }
      if (containing == items.size())
        error(transition ? "Insert a Transition inside one KeyArtHold."
                         : "Insert a Hold inside one existing Hold.");
      auto old = items[containing];
      if (transition &&
          field(old, "keyArtId") != field(reference, "fromKeyArtId"))
        error("Transition start KeyArt must match the containing Hold.");
      items.erase(items.begin() + static_cast<std::ptrdiff_t>(containing));
      const bool left = number(start) > number(field(old, "startTicks"));
      if (left)
        items.push_back(merge(old, Value(Object{{"endTicks", start}})));
      items.emplace_back(Object{
          {"id", id},
          {"kind", Value(transition ? "TransitionInstance" : "KeyArtHold")},
          {transition ? "transitionId" : "keyArtId", field(reference, "id")},
          {"startTicks", start},
          {"endTicks", end}});
      if (number(end) < number(field(old, "endTicks"))) {
        auto right =
            transition
                ? Value(Object{{"id", field(old, "id")},
                               {"kind", Value("KeyArtHold")},
                               {"keyArtId", field(reference, "toKeyArtId")},
                               {"endTicks", field(old, "endTicks")}})
                : old;
        right.get<Object>()["startTicks"] = end;
        if (left)
          right.get<Object>()["id"] = ids.next("view");
        items.push_back(right);
      }
      return view_plan(sequence, items,
                       transition ? "Insert ViewLane Transition"
                                  : "Insert ViewLane Hold");
    }
    if (tool == "view.reorder") {
      const auto direction = text(field(input, "direction"));
      if (direction != "earlier" && direction != "later")
        error("Direction must be earlier or later.");
      if (index == items.size() || (direction == "earlier" && index == 0) ||
          (direction == "later" && index + 1 == items.size()))
        return plan({}, "");
      auto low = direction == "earlier" ? index - 1 : index, high = low + 1;
      auto a = items[low], b = items[high];
      auto start = number(field(a, "startTicks")),
           boundary = start + number(field(b, "endTicks")) -
                      number(field(b, "startTicks")),
           end = boundary + number(field(a, "endTicks")) - start;
      items[low] = merge(b, Value(Object{{"startTicks", Value(start)},
                                         {"endTicks", Value(boundary)}}));
      items[high] = merge(a, Value(Object{{"startTicks", Value(boundary)},
                                          {"endTicks", Value(end)}}));
      return view_plan(sequence, items, "Reorder ViewLane items");
    }
    if (index == items.size())
      error("Unknown ViewLane item " + text(field(input, "itemId")) + ".");
    if (tool == "view.update") {
      const auto start = field(input, "startTicks"),
                 end = field(input, "endTicks"),
                 ref = field(input, "referenceId");
      if (index == 0 && start != Value(0.0))
        error("The first ViewLane item must start at tick 0.");
      if (index + 1 == items.size() && end != field(sequence, "durationTicks"))
        error("The last ViewLane item must end at the Sequence duration.");
      const bool hold = field(items[index], "kind") == Value("KeyArtHold");
      query(p, hold ? "keyart.get" : "transition.get",
            {{hold ? "keyArtId" : "transitionId", ref}});
      items[index] = merge(
          items[index], Value(Object{{hold ? "keyArtId" : "transitionId", ref},
                                     {"startTicks", start},
                                     {"endTicks", end}}));
      if (index)
        items[index - 1].get<Object>()["endTicks"] = start;
      if (index + 1 < items.size())
        items[index + 1].get<Object>()["startTicks"] = end;
      return view_plan(sequence, items, "Update ViewLane item");
    }
    if (tool == "view.remove") {
      if (items.size() == 1)
        error("A Sequence must retain complete ViewLane coverage.");
      auto old = items[index];
      items.erase(items.begin() + static_cast<std::ptrdiff_t>(index));
      auto absorb = truthy(field(input, "absorb"))
                        ? text(field(input, "absorb"))
                        : "previous";
      if (absorb == "previous" && index)
        items[index - 1].get<Object>()["endTicks"] = field(old, "endTicks");
      else {
        if (index >= items.size())
          error("Choose a neighboring ViewLane item to absorb the duration.");
        items[index].get<Object>()["startTicks"] = field(old, "startTicks");
      }
      return view_plan(sequence, items, "Remove ViewLane item");
    }
  }
  if (tool == "clip.create") {
    auto id = allocated("clipId", "clip"),
         program = allocated("programId", "program"), d = duration(input);
    auto loop =
        input.is<Object>() && input.get<Object>().count("defaultLoopMode")
            ? field(input, "defaultLoopMode")
            : Value("once");
    return plan(
        {command("animation.temporal.create_program",
                 {{"programId", program}, {"durationTicks", d}}),
         command("animation.clip.create",
                 {{"clip",
                   Value(Object{{"id", id},
                                {"displayName", field(input, "displayName")},
                                {"temporalProgramId", program},
                                {"defaultLoopMode", loop},
                                {"metadata", Value(Object{})}})}})},
        "Create AnimationClip", {{"clipId", id}, {"programId", program}});
  }
  if (tool == "clip.update" || tool == "clip.remove") {
    if (!clip.is<Object>())
      error("Select an AnimationClip first.");
    const auto id = field(clip, "id"),
               program = field(clip, "temporalProgramId");
    if (tool == "clip.remove")
      return plan({command("animation.clip.remove", {{"clipId", id}}),
                   command("animation.temporal.remove_program",
                           {{"programId", program}})},
                  "Remove AnimationClip");
    Array commands{
        command("animation.clip.update",
                {{"clipId", id},
                 {"clip", merge(stored_owner(clip), field(input, "patch"))}})};
    auto d = duration(input);
    if (!d.is<picojson::null>() && d != field(clip, "durationTicks"))
      commands.push_back(
          command("animation.temporal.set_duration",
                  {{"programId", program}, {"durationTicks", d}}));
    return plan(commands, "Update AnimationClip");
  }
  if (tool == "instance.add") {
    auto id = allocated("clipInstanceId", "clip_instance");
    if (!sequence.is<Object>())
      error("Select a Sequence first.");
    auto get_default = [&](const char *key, const Value &value) {
      return input.is<Object>() && input.get<Object>().count(key)
                 ? field(input, key)
                 : value;
    };
    auto clip_id = get_default("clipId", field(clip, "id"));
    auto target_clip = query(p, "animation.clip.get", {{"clipId", clip_id}});
    auto r = rate(get_default(
        "playbackRate",
        Value(Object{{"numerator", Value(1.0)}, {"denominator", Value(1.0)}})));
    auto start = get_default("startTicks", Value(c.ticks)),
         end = field(input, "endTicks");
    if (end.is<picojson::null>()) {
      auto projected =
          fl2d_ticks::UInt128(static_cast<uint64_t>(
                                  number(field(target_clip, "durationTicks"))))
              .times(static_cast<uint64_t>(number(field(r, "denominator"))))
              .divmod(fl2d_ticks::UInt128(
                  static_cast<uint64_t>(number(field(r, "numerator")))))
              .first;
      if (!projected.safe())
        range_error(
            "Default ClipInstance placement exceeds the safe integer range.");
      end = Value(std::min(
          number(field(sequence, "durationTicks")),
          number(start) + std::max(1.0, static_cast<double>(projected.low()))));
    }
    auto instance = Value(Object{
        {"id", id},
        {"clipId", clip_id},
        {"startTicks", start},
        {"endTicks", end},
        {"sourceOffsetTicks", get_default("sourceOffsetTicks", Value(0.0))},
        {"playbackRate", r},
        {"loopMode", truthy(field(input, "loopMode"))
                         ? field(input, "loopMode")
                         : field(target_clip, "defaultLoopMode")},
        {"weight", get_default("weight", Value(1.0))},
        {"layer", get_default("layer", Value(0.0))},
        {"enabled", get_default("enabled", Value(true))}});
    return plan(
        {command("sequence.add_clip_instance",
                 {{"sequenceId", sequence_id}, {"clipInstance", instance}})},
        "Add ClipInstance", {{"clipInstanceId", id}});
  }
  if (tool == "instance.update") {
    const auto id = field(input, "clipInstanceId");
    auto instance = find(field(sequence, "clipInstances"), id);
    if (!instance.is<Object>())
      error("Unknown ClipInstance " + text(id) + ".");
    auto next = merge(instance, field(input, "patch"));
    next.get<Object>()["id"] = id;
    if (truthy(field(next, "playbackRate")))
      next.get<Object>()["playbackRate"] = rate(field(next, "playbackRate"));
    return plan(
        {command("sequence.update_clip_instance", {{"sequenceId", sequence_id},
                                                   {"clipInstanceId", id},
                                                   {"clipInstance", next}})},
        "Move ClipInstance");
  }
  if (tool == "instance.remove") {
    const auto id = field(input, "clipInstanceId");
    if (!sequence.is<Object>() || !truthy(id))
      error("Select a ClipInstance first.");
    return plan(
        {command("sequence.remove_clip_instance",
                 {{"sequenceId", sequence_id}, {"clipInstanceId", id}})},
        "Remove ClipInstance");
  }
  if (tool == "track.add") {
    const auto kind = text(field(input, "kind"));
    auto kinds = allowed(c.owner_kind);
    if (std::find(kinds.begin(), kinds.end(), Value(kind)) == kinds.end())
      error(c.transition.is<Object>()
                ? "Unsupported Transition track kind."
                : kind + " is not valid for the selected " +
                      (c.owner_kind.empty() ? "owner" : c.owner_kind) + ".");
    if (!c.program.is<Object>())
      error("Choose a Sequence or AnimationClip program first.");
    if (!c.transition.is<Object>()) {
      bool matched = false;
      for (const auto &o : targets(p, kind))
        if (field(o, "target") == field(input, "target"))
          matched = true;
      if (!matched)
        error("Choose an existing stable typed target.");
    }
    auto id = !c.transition.is<Object>() ? allocated("trackId", "track")
                                         : ids.next("track");
    Object channels;
    const auto &names =
        field(field(field(definitions(), "tracks"), kind), "channels");
    for (const auto &name : names.get<Array>())
      channels[text(name)] = Value(Object{{"keyframes", Value(Array{})}});
    return plan(
        {command("animation.temporal.add_track",
                 {{"programId", field(c.program, "id")},
                  {"track", Value(Object{{"trackId", id},
                                         {"version", Value(1.0)},
                                         {"kind", Value(kind)},
                                         {"target", field(input, "target")},
                                         {"channels", Value(channels)}})}})},
        c.transition.is<Object>() ? "Add Transition track"
                                  : "Add Animation track",
        {{"trackId", id}});
  }
  return key_command(c, tool, input, ids);
}
Value playback_tick(const Value &p, const Value &input) {
  const auto &playback = field(input, "playback"),
             &elapsed = field(playback, "elapsedMilliseconds");
  if (!elapsed.is<double>() || !std::isfinite(elapsed.get<double>()) ||
      elapsed.get<double>() < 0)
    error("Invalid playback sample.");
  const bool sequence = truthy(field(input, "sequenceId"));
  auto owner =
      query(p, sequence ? "sequence.get" : "transition.get",
            {{sequence ? "sequenceId" : "transitionId",
              field(input, sequence ? "sequenceId" : "transitionId")}});
  auto program = query(p, "animation.get_program",
                       {{"programId", field(owner, "temporalProgramId")}});
  auto d = number(field(program, "durationTicks"));
  auto mode = text(field(playback, "mode"));
  if (mode != "once" && mode != "loop")
    error("Unknown playback mode " + mode + ".");
  auto start = field(playback, "startTicks");
  if (!safe(start))
    range_error("Timeline tick must be a safe integer.");
  double tick = std::clamp(start.get<double>(), 0.0, d);
  if (mode == "once" && tick == d)
    tick = 0;
  double absolute = tick + std::floor(elapsed.get<double>() * 120000 / 1000);
  if (!std::isfinite(absolute))
    range_error("Playback sample exceeds the finite tick range.");
  auto result = mode == "loop" ? std::fmod(absolute, d) : std::min(d, absolute);
  return Value(Object{{"timeTicks", Value(result)},
                      {"playing", Value(mode == "loop" || result < d)}});
}
} // namespace fl2d_authoring
namespace fl2d_authoring {
namespace {
Value nullable(const Value &v) { return truthy(v) ? v : Value(); }
Value first(const Value &a, const Value &b) {
  return truthy(a) ? a : nullable(b);
}
Array projected_items(const Value &sequence, const char *field_name) {
  Array result;
  auto d = number(field(sequence, "durationTicks"));
  const auto &items = field(sequence, field_name);
  if (!items.is<Array>())
    return result;
  for (auto item : items.get<Array>()) {
    auto start = number(field(item, "startTicks")),
         end = number(field(item, "endTicks"));
    result.push_back(merge(
        item, Value(Object{{"startProgress", Value(d ? start / d : 0)},
                           {"endProgress", Value(d ? end / d : 0)},
                           {"widthProgress", Value(d ? (end - start) / d : 0)},
                           {"selected", Value(false)},
                           {"previewing", Value(false)}})));
  }
  return result;
}
Value evaluated(const Value &p, const std::string &name, const Object &input,
                Value &failure, bool normalized) {
  auto result = fl2d_queries::query(p, name, Value(input));
  const auto &issue = field(result, "error");
  if (issue.is<Object>()) {
    failure =
        normalized
            ? merge(issue,
                    Value(Object{{"issues", field(issue, "issues").is<Array>()
                                                ? field(issue, "issues")
                                                : Value(Array{})}}))
            : Value(Object{});
    return Value();
  }
  return field(result, "value");
}
} // namespace
Value transition_diagnostics(const Value &transition_id,
                             const Value &validation, const Value &evaluation,
                             const Value &failure) {
  Array out;
  std::map<std::string, size_t> by_key;
  auto push = [&](const Value &value) {
    auto key = text(field(value, "key"));
    auto found = by_key.find(key);
    if (found == by_key.end()) {
      by_key[key] = out.size();
      out.push_back(value);
    } else if (field(out[found->second], "source") == Value("validation") &&
               field(value, "source") == Value("evaluation"))
      out[found->second] = value;
  };
  auto core = [&](const Value &entries, const std::string &source) {
    if (!entries.is<Array>())
      return;
    for (const auto &entry : entries.get<Array>()) {
      const auto details = field(entry, "details");
      auto severity = text(field(entry, "severity"));
      if (severity != "error" && severity != "warning" && severity != "info")
        severity = "error";
      auto endpoint = field(details, "endpoint");
      if (endpoint != Value("from") && endpoint != Value("to")) {
        const auto missing = field(details, "missingEndpoints");
        endpoint = missing.is<Array>() && missing.get<Array>().size() == 1
                       ? missing.get<Array>()[0]
                       : Value();
      }
      Object target{{"transitionId", nullable(field(entry, "transitionId"))},
                    {"semanticSlotId", first(field(entry, "semanticSlotId"),
                                             field(details, "semanticSlotId"))},
                    {"endpoint", endpoint},
                    {"preview", Value(false)},
                    {"nodeId", first(field(details, "nodeId"),
                                     field(details, "sourceNodeId"))}};
      for (auto key :
           {"partTransitionId", "fromNodeId", "toNodeId", "topologyId",
            "keyformId", "fromKeyformId", "toKeyformId"})
        target[key] = nullable(field(details, key));
      for (auto key : {"trackId", "channel", "keyframeId"})
        target[key] = first(field(details, key), field(entry, key));
      auto fallback = [&](const char *key) {
        return truthy(field(entry, key)) ? text(field(entry, key)) : "-";
      };
      auto key = truthy(field(entry, "key"))
                     ? field(entry, "key")
                     : Value(source + "|" + text(field(entry, "code")) + "|" +
                             fallback("transitionId") + "|" +
                             fallback("semanticSlotId"));
      push(merge(entry, Value(Object{{"key", key},
                                     {"severity", Value(severity)},
                                     {"message", truthy(field(entry, "message"))
                                                     ? field(entry, "message")
                                                     : field(entry, "code")},
                                     {"source", Value(source)},
                                     {"authorityImpact",
                                      Value(severity == "error" ? "blocks"
                                                                : "advisory")},
                                     {"target", Value(target)}})));
    }
  };
  core(validation, "validation");
  core(field(evaluation, "diagnostics"), "evaluation");
  if (!failure.is<picojson::null>()) {
    // JS Error serializes as {}, while its diagnostic retains the message.
    auto message = field(failure, "message");
    push(Value(Object{{"key", Value("evaluation-error|" + text(transition_id) +
                                    "|" + text(message))},
                      {"code", Value("TRANSITION_EVALUATION_ERROR")},
                      {"severity", Value("error")},
                      {"message", message},
                      {"transitionId", transition_id},
                      {"source", Value("evaluation")},
                      {"authorityImpact", Value("blocks")},
                      {"target", Value(Object{{"transitionId", transition_id},
                                              {"preview", Value(true)}})}}));
  }
  if (evaluation.is<Object>())
    push(Value(Object{
        {"key", Value("renderer-pending|" + text(transition_id))},
        {"code", Value("TRANSITION_RENDERER_VALIDATION_PENDING")},
        {"severity", Value("info")},
        {"message", Value("Renderer validation pending or unavailable.")},
        {"transitionId", transition_id},
        {"source", Value("renderer")},
        {"authorityImpact", Value("blocks")},
        {"target", Value(Object{{"transitionId", transition_id},
                                {"preview", Value(true)}})}}));
  Array reasons;
  for (const auto &item : out)
    if (field(item, "authorityImpact") == Value("blocks"))
      reasons.push_back(field(item, "message"));
  return Value(Object{{"diagnostics", Value(out)},
                      {"authoritative", Value(false)},
                      {"authorityReasons", Value(reasons)}});
}
Value timeline_state(const Value &p, const Value &context) {
  Context c(p, context);
  auto keyarts = query(p, "keyart.list"),
       transitions = query(p, "transition.list"),
       samples = query(p, "animation.deformation_sample.list");
  auto channels = c.track.is<Object>() ? field(field(definitions(), "channels"),
                                               text(field(c.track, "kind")))
                                       : Value(Object{});
  Array tracks;
  const auto &raw = field(c.program, "tracks");
  if (raw.is<Array>())
    for (const auto &track : raw.get<Array>()) {
      Object fields{{"targetLabel", Value(label(field(track, "target"),
                                                c.transition.is<Object>()))}};
      if (c.transition.is<Object>())
        fields["targetKind"] = Value(
            field(field(track, "target"), "transitionDefault") == Value(true)
                ? "default"
            : truthy(field(field(track, "target"), "semanticSlotId"))
                ? "semantic-override"
                : "node-override");
      tracks.push_back(merge(track, Value(fields)));
    }
  Object state{
      {"program", c.program},
      {"tracks", Value(tracks)},
      {"selectedTrack", c.track},
      {"selectedTrackId", nullable(field(c.track, "trackId"))},
      {"selectedKeyframe", c.key_selection},
      {"currentTick", Value(c.ticks)},
      {"keyArts", keyarts},
      {"transitions", transitions},
      {"deformationSamples", samples},
      {"channels", channels},
      {"allowedTrackKinds", Value(allowed(c.owner_kind))},
      {"targetOptions", Value(targets(p, text(field(context, "trackKind")),
                                      c.transition.is<Object>()))}};
  if (c.transition.is<Object>()) {
    auto id = field(c.transition, "id");
    auto result = fl2d_queries::query(
        p, "transition.evaluate",
        Value(Object{{"transitionId", id}, {"timeTicks", Value(c.ticks)}}));
    auto failure = field(result, "error"), evaluation = field(result, "value");
    auto projected = transition_diagnostics(
        id, query(p, "transition.get_diagnostics", {{"transitionId", id}}),
        evaluation, failure);
    for (const auto &v : projected.get<Object>())
      state[v.first] = v.second;
    state["evaluationError"] = failure.is<Object>() ? Value(Object{}) : Value();
    state["viewMode"] = Value("preview");
    state["normalizedProgress"] =
        Value(c.ticks / number(field(c.program, "durationTicks")));
    state["activeTransition"] = c.transition;
    state["transitionId"] = id;
    state["sequence"] = Value();
    state["selectedClipId"] = Value();
    state["selectedClip"] = Value();
    for (auto name : {"clips", "clipInstances", "viewItems"})
      state[name] = Value(Array{});
    state["durationSeconds"] =
        Value(number(field(c.program, "durationTicks")) / 120000);
    Array appearances;
    for (auto art_key : {"fromKeyArtId", "toKeyArtId"}) {
      auto art =
          query(p, "keyart.get", {{"keyArtId", field(c.transition, art_key)}});
      for (const auto &member : field(art, "members").get<Array>()) {
        auto id2 = field(member, "appearanceId");
        auto node = field(field(field(p, "scene"), "nodes"),
                          text(field(member, "nodeId")));
        auto name = truthy(field(node, "displayName"))
                        ? text(field(node, "displayName"))
                        : "画像";
        auto option = Value(Object{
            {"id", id2},
            {"label", Value(text(field(art, "displayName")) + " · " + name)}});
        auto existing =
            std::find_if(appearances.begin(), appearances.end(),
                         [&](const Value &v) { return field(v, "id") == id2; });
        if (existing == appearances.end())
          appearances.push_back(option);
        else
          *existing = option;
      }
    }
    state["appearanceOptions"] = Value(appearances);
    return Value(state);
  }
  Array sequences;
  auto sequence_list = query(p, "sequence.list");
  for (const auto &entry : sequence_list.get<Array>())
    sequences.emplace_back(Object{
        {"id", field(entry, "id")},
        {"displayName", field(entry, "displayName")},
        {"durationTicks", field(entry, "durationTicks")},
        {"selected", Value(field(entry, "id") == field(c.sequence, "id"))}});
  auto clips = query(p, "animation.clip.list");
  for (auto &entry : clips.get<Array>())
    entry.get<Object>()["selected"] =
        Value(field(entry, "id") == field(c.clip, "id"));
  auto view = projected_items(c.sequence, "viewLaneItems");
  for (auto &item : view) {
    const bool hold = field(item, "kind") == Value("KeyArtHold");
    auto reference = query(p, hold ? "keyart.get" : "transition.get",
                           {{hold ? "keyArtId" : "transitionId",
                             field(item, hold ? "keyArtId" : "transitionId")}});
    item.get<Object>()["referenceId"] = field(reference, "id");
    item.get<Object>()["referenceName"] = field(reference, "displayName");
  }
  auto instances = projected_items(c.sequence, "clipInstances");
  for (auto &item : instances) {
    auto clip = find(clips, field(item, "clipId"));
    item.get<Object>()["clipName"] = truthy(field(clip, "displayName"))
                                         ? field(clip, "displayName")
                                         : field(item, "clipId");
  }
  Value failure, evaluation;
  Array diagnostics;
  if (c.sequence.is<Object>()) {
    auto id = field(c.sequence, "id");
    evaluation = evaluated(p, "sequence.evaluate",
                           {{"sequenceId", id}, {"timeTicks", Value(c.ticks)}},
                           failure, true);
    auto report = query(p, "sequence.get_diagnostics", {{"sequenceId", id}});
    diagnostics = field(report, "issues").get<Array>();
    const auto &e = field(evaluation, "diagnostics");
    if (e.is<Array>())
      diagnostics.insert(diagnostics.end(), e.get<Array>().begin(),
                         e.get<Array>().end());
  }
  state["sequences"] = Value(sequences);
  state["selectedSequenceId"] = nullable(field(c.sequence, "id"));
  state["sequence"] = c.sequence;
  state["viewItems"] = Value(view);
  state["selectedViewItemId"] = Value();
  state["clips"] = clips;
  state["selectedClip"] = c.clip;
  state["selectedClipId"] = nullable(field(c.clip, "id"));
  state["clipInstances"] = Value(instances);
  state["selectedClipInstance"] = Value();
  state["selectedClipInstanceId"] = Value();
  state["ownerContext"] =
      c.owner.is<Object>()
          ? Value(Object{{"kind", Value(c.owner_kind)},
                         {"id", field(c.owner, "id")},
                         {"displayName", first(field(c.owner, "displayName"),
                                               field(c.owner, "id"))}})
          : Value();
  state["selectedKeyframeValue"] = c.keyframe;
  state["timeDisplay"] =
      Value(Object{{"unit", Value("ticks")},
                   {"value", Value(c.ticks)},
                   {"exact", Value(true)},
                   {"label", Value(Value(c.ticks).serialize() + " ticks")}});
  state["displayUnit"] = Value("ticks");
  state["playbackMode"] = Value("once");
  state["playing"] = Value(false);
  state["evaluationError"] = failure;
  state["diagnostics"] = Value(diagnostics);
  state["operationError"] = Value();
  state["durationSeconds"] =
      Value(c.sequence.is<Object>()
                ? number(field(c.sequence, "durationTicks")) / 120000
                : 8);
  state["clipDurationSeconds"] = Value(
      c.clip.is<Object>() ? number(field(c.clip, "durationTicks")) / 120000
                          : 1);
  state["trackDefinitions"] = field(definitions(), "tracks");
  state["easePresets"] = field(definitions(), "easePresets");
  if (!truthy(field(context, "trackKind")))
    state["targetOptions"] = Value(Array{});
  auto raw_tick = truthy(field(context, "timeTicks"))
                      ? field(context, "timeTicks")
                      : Value(0.0);
  if (!safe(raw_tick) || number(raw_tick) < 0)
    range_error("Timeline display tick must be a non-negative safe integer.");
  std::ostringstream seconds;
  seconds << std::fixed << std::setprecision(6) << number(raw_tick) / 120000;
  auto seconds_label = seconds.str();
  while (seconds_label.back() == '0')
    seconds_label.pop_back();
  if (seconds_label.back() == '.')
    seconds_label.pop_back();
  state["secondsLabel"] =
      Value(seconds_label + " s · " + raw_tick.serialize() + " ticks");
  return Value(state);
}
} // namespace fl2d_authoring
