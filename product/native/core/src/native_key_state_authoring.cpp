#include "native_authoring.h"
#include <algorithm>
#include <cmath>
#include <map>
#include <set>
namespace fl2d_authoring {
namespace {
Value extend(Value value, const Object &fields) {
  if (!value.is<Object>())
    value = Value(Object{});
  for (const auto &item : fields)
    value.get<Object>()[item.first] = item.second;
  return value;
}
Value persistent(Value value) {
  value.get<Object>().erase("durationTicks");
  return value;
}
Value null_if_empty(const Value &v) { return truthy(v) ? v : Value(); }
Array modes() {
  return Array{Value("morph"),  Value("hold"),      Value("replace"),
               Value("appear"), Value("disappear"), Value("occlusion")};
}
Value mapping(const Value &slot, const Value &art) {
  const auto &values = field(slot, "mappings");
  if (values.is<Array>())
    for (const auto &v : values.get<Array>())
      if (field(v, "keyArtId") == art)
        return v;
  return Value();
}
Value authoring_state(const Value &p, const Value &context) {
  const auto arts = query(p, "keyart.list"),
             transitions = query(p, "transition.list");
  auto transition = find(transitions, field(context, "transitionId"));
  auto art = find(arts, field(context, "keyArtId"));
  if (truthy(field(context, "transitionId")) && !transition.is<Object>())
    error("Unknown Transition " + text(field(context, "transitionId")) + ".");
  if (truthy(field(context, "keyArtId")))
    query(p, "keyart.get", {{"keyArtId", field(context, "keyArtId")}});
  if (truthy(field(context, "semanticSlotId")))
    query(p, "semantic_slot.get",
          {{"semanticSlotId", field(context, "semanticSlotId")}});
  auto projected = transition.is<Object>()
                       ? query(p, "transition.get_authoring",
                               {{"transitionId", field(transition, "id")}})
                       : Value();
  auto slots = projected.is<Object>() ? field(projected, "semanticSlots")
                                      : Value(Array{});
  auto selected = find(slots, field(context, "semanticSlotId"));
  return Value(Object{
      {"activeTransitionId", null_if_empty(field(context, "transitionId"))},
      {"activeTransitionMissing", Value(false)},
      {"selectedKeyArtId", null_if_empty(field(context, "keyArtId"))},
      {"selectedSemanticSlotId",
       null_if_empty(field(context, "semanticSlotId"))},
      {"transitions", transitions},
      {"keyArts", arts},
      {"semanticSlots", slots},
      {"activeTransition",
       projected.is<Object>() ? field(projected, "transition") : transition},
      {"selectedKeyArt", art},
      {"selectedSemanticSlot", selected},
      {"endpoints", field(projected, "endpoints")}});
}
Value editable(const Value &p, const Value &id) {
  auto form = query(p, "mesh.get_keyform", {{"keyformId", id}});
  auto m = query(p, "semantic_slot.get_mapping",
                 {{"semanticSlotId", field(form, "semanticSlotId")},
                  {"keyArtId", field(form, "keyArtId")}});
  if (!m.is<Object>())
    error("Mesh Key Art mapping is missing.");
  auto node = query(p, "scene.get_node", {{"nodeId", field(m, "nodeId")}});
  if (truthy(field(node, "locked")) || !truthy(field(node, "effectiveVisible")))
    error("非表示・ロック中のメッシュは編集できません。");
  return form;
}
Value seconds_ticks(const Value &v) {
  if (!v.is<double>() || !std::isfinite(v.get<double>()) || v.get<double>() < 0)
    throw fl2d_queries::Error{"RangeError",
                              "Seconds must be a non-negative finite number."};
  auto ticks = std::floor(v.get<double>() * 120000 + .5);
  if (!std::isfinite(ticks) || ticks > 9007199254740991.0)
    throw fl2d_queries::Error{"RangeError",
                              "Tick value exceeds the safe integer range."};
  return Value(ticks);
}
bool finite(const Value &v) {
  return v.is<double>() && std::isfinite(v.get<double>());
}
} // namespace
Value key_state(const Value &p, const Value &context) {
  auto state = authoring_state(p, context);
  Object extra;
  extra["node"] =
      truthy(field(context, "nodeId"))
          ? query(p, "scene.get_node", {{"nodeId", field(context, "nodeId")}})
          : Value();
  Array groups, nodes;
  const auto &all = field(field(p, "scene"), "nodes").get<Object>();
  for (const auto &id : all.keys()) {
    const auto &n = all.at(id);
    auto item = Value(Object{{"id", field(n, "id")},
                             {"displayName", field(n, "displayName")}});
    if (field(n, "kind") == Value("group"))
      groups.push_back(item);
    if (field(n, "kind") == Value("part"))
      nodes.push_back(item);
  }
  extra["groups"] = Value(groups);
  extra["nodes"] = Value(nodes);
  auto transition = field(state, "activeTransition");
  extra["durationSeconds"] =
      Value(transition.is<Object>()
                ? number(field(transition, "durationTicks")) / 120000
                : 1);
  extra["slots"] = query(p, "semantic_slot.list");
  extra["keyforms"] = query(p, "mesh.list_keyforms");
  extra["topologies"] = query(p, "mesh.list_topologies");
  extra["modes"] = Value(modes());
  extra["diagnostics"] =
      transition.is<Object>()
          ? query(p, "transition.get_diagnostics",
                  {{"transitionId", field(transition, "id")}})
          : Value(Array{});
  extra["samples"] = query(p, "animation.deformation_sample.list");
  extra["meshes"] = query(p, "mesh.list");
  return extend(state, extra);
}
Value correspondence_state(const Value &p, const Value &request) {
  const auto state = authoring_state(p, field(request, "context")),
             input = field(request, "input");
  const auto slot = field(state, "selectedSemanticSlot"),
             part = field(slot, "partTransition");
  auto topology_id = field(field(slot, "morphReferences"), "topologyId");
  auto topology = find(query(p, "mesh.list_topologies"), topology_id);
  const bool reverse = truthy(field(input, "reverse"));
  auto source = find(query(p, "mesh.list_keyforms"),
                     field(part, reverse ? "toKeyformId" : "fromKeyformId")),
       target = find(query(p, "mesh.list_keyforms"),
                     field(part, reverse ? "fromKeyformId" : "toKeyformId"));
  auto preset =
      truthy(field(input, "preset")) ? text(field(input, "preset")) : "normal";
  if (preset != "soft" && preset != "normal" && preset != "firm")
    error("Unknown solver preset " + preset + ".");
  const auto pins = field(input, "pins");
  if (!pins.is<Array>() || pins.get<Array>().size() > 10000)
    error("Invalid correspondence pins.");
  const auto &vertex_ids = field(topology, "vertexIds");
  std::map<std::string, size_t> indices;
  std::set<std::string> seen;
  if (vertex_ids.is<Array>())
    for (size_t i = 0; i < vertex_ids.get<Array>().size(); ++i)
      indices[text(vertex_ids.get<Array>()[i])] = i;
  Array projected_pins;
  std::string selected;
  for (const auto &pin : pins.get<Array>()) {
    auto id = text(field(pin, "vertexId"));
    if (!indices.count(id))
      error("Unknown stable vertex ID " + (id.empty() ? "(missing)" : id) +
            ".");
    if (!seen.insert(id).second)
      error("Stable vertex " + id + " already has a correspondence pin.");
    const auto anchor = field(pin, "target");
    if (!finite(field(anchor, "x")) || !finite(field(anchor, "y")))
      error("Correspondence target anchor must contain finite mesh-local "
            "coordinates.");
    auto i = indices.at(id);
    Value point;
    if (source.is<Object>()) {
      const auto &positions = field(source, "positions").get<Array>();
      point =
          Value(Object{{"x", positions[i * 2]}, {"y", positions[i * 2 + 1]}});
    }
    projected_pins.emplace_back(Object{
        {"vertexId", field(pin, "vertexId")},
        {"target",
         Value(Object{{"x", field(anchor, "x")}, {"y", field(anchor, "y")}})},
        {"source", point},
        {"semanticLabel",
         null_if_empty(field(field(field(topology, "vertexMetadata"), id),
                             "semanticLabel"))}});
    selected = id;
  }
  Array diagnostics, candidate;
  auto fail = [&](const std::string &code, const std::string &message,
                  const Object &details = Object{}) {
    diagnostics.emplace_back(Object{{"code", Value(code)},
                                    {"message", Value(message)},
                                    {"details", Value(details)}});
  };
  if (!source.is<Object>())
    fail("CORRESPONDENCE_MISSING_SOURCE_KEYFORM",
         "A source MeshKeyform is required.");
  else if (!target.is<Object>())
    fail("CORRESPONDENCE_MISSING_TARGET_KEYFORM",
         "A target MeshKeyform is required.");
  else if (!topology.is<Object>() ||
           field(source, "topologyId") != field(topology, "id") ||
           field(target, "topologyId") != field(topology, "id"))
    fail("CORRESPONDENCE_TOPOLOGY_MISMATCH",
         "Source and target MeshKeyforms must share the selected MeshTopology.",
         {{"topologyId", field(topology, "id")},
          {"sourceTopologyId", field(source, "topologyId")},
          {"targetTopologyId", field(target, "topologyId")}});
  else if (pins.get<Array>().empty())
    fail("CORRESPONDENCE_NO_PINS",
         "Add at least one correspondence pin before solving.");
  if (diagnostics.empty()) {
    // Runtime work is bounded even for adversarial imported topology/pins.
    const auto count = vertex_ids.get<Array>().size();
    if (count && pins.get<Array>().size() > 50000000 / count)
      error("Correspondence work exceeds the native limit.");
    struct Pin {
      size_t i;
      std::string id;
      double sx, sy, tx, ty;
    };
    std::vector<Pin> resolved;
    const auto &positions = field(source, "positions").get<Array>();
    for (const auto &pin : pins.get<Array>()) {
      auto id = text(field(pin, "vertexId"));
      auto i = indices.at(id);
      resolved.push_back({i, id, number(positions[i * 2]),
                          number(positions[i * 2 + 1]),
                          number(field(field(pin, "target"), "x")),
                          number(field(field(pin, "target"), "y"))});
    }
    std::sort(resolved.begin(), resolved.end(),
              [](const Pin &a, const Pin &b) { return a.i < b.i; });
    for (size_t a = 0; a < resolved.size() && diagnostics.empty(); ++a)
      for (size_t b = a + 1; b < resolved.size(); ++b)
        if (std::hypot(resolved[a].sx - resolved[b].sx,
                       resolved[a].sy - resolved[b].sy) <= 1e-9) {
          fail("CORRESPONDENCE_POORLY_CONDITIONED",
               "Two pinned stable vertices occupy the same source position.",
               {{"vertexIds",
                 Value(Array{Value(resolved[a].id), Value(resolved[b].id)})}});
          break;
        }
    if (diagnostics.empty()) {
      candidate = positions;
      auto power = preset == "soft" ? 1.0 : preset == "firm" ? 4.0 : 2.0;
      for (size_t i = 0; i < count; ++i) {
        auto x = number(positions[i * 2]), y = number(positions[i * 2 + 1]);
        if (resolved.size() == 1) {
          candidate[i * 2] = Value(x + (resolved[0].tx - resolved[0].sx));
          candidate[i * 2 + 1] = Value(y + (resolved[0].ty - resolved[0].sy));
        } else if (!seen.count(text(vertex_ids.get<Array>()[i]))) {
          double total = 0, dx = 0, dy = 0;
          for (const auto &pin : resolved) {
            auto distance = std::max(1e-9, std::hypot(x - pin.sx, y - pin.sy)),
                 weight = 1 / std::pow(distance, power);
            total += weight;
            dx += weight * (pin.tx - pin.sx);
            dy += weight * (pin.ty - pin.sy);
          }
          candidate[i * 2] = Value(x + dx / total);
          candidate[i * 2 + 1] = Value(y + dy / total);
        }
      }
      for (const auto &pin : resolved) {
        candidate[pin.i * 2] = Value(pin.tx);
        candidate[pin.i * 2 + 1] = Value(pin.ty);
      }
      for (const auto &v : candidate)
        if (!finite(v)) {
          fail("CORRESPONDENCE_NON_FINITE_RESULT",
               "The correspondence solve produced a non-finite position.");
          candidate.clear();
          break;
        }
    }
  }
  auto source_endpoint = Value(reverse ? "to" : "from"),
       target_endpoint = Value(reverse ? "from" : "to");
  bool available = !candidate.empty() && diagnostics.empty();
  Value candidate_context =
      available ? Value(Object{{"topologyId", field(topology, "id")},
                               {"sourceKeyformId", field(source, "id")},
                               {"targetKeyformId", field(target, "id")},
                               {"sourceEndpoint", source_endpoint},
                               {"targetEndpoint", target_endpoint}})
                : Value();
  return Value(Object{
      {"sourceEndpoint", source_endpoint},
      {"targetEndpoint", target_endpoint},
      {"sourceKeyformId", field(source, "id")},
      {"targetKeyformId", field(target, "id")},
      {"topologyId", field(topology, "id")},
      {"pins", Value(projected_pins)},
      {"selectedPinId", selected.empty() ? Value() : Value(selected)},
      {"pendingVertexId", Value()},
      {"preset", Value(preset)},
      {"candidatePositions", available ? Value(candidate) : Value()},
      {"candidateContext", candidate_context},
      {"diagnostics", Value(diagnostics)},
      {"previewActive", Value(available)},
      {"pinCount", Value(static_cast<double>(pins.get<Array>().size()))}});
}
Value key_state_tool(const Value &p, const Value &request) {
  const auto context = field(request, "context"),
             input = field(request, "input"),
             state = authoring_state(p, context);
  const auto tool = text(field(request, "tool"));
  Ids ids(request);
  const auto transition = field(state, "activeTransition"),
             slot = field(state, "selectedSemanticSlot");
  const auto transition_id = field(context, "transitionId"),
             slot_id = field(context, "semanticSlotId"),
             art_id = field(context, "keyArtId"),
             node_id = field(context, "nodeId");
  auto run = [&](const std::string &type, const Object &payload,
                 const std::string &title = "Edit") {
    return plan({command(type, payload)}, title);
  };
  if (tool == "object.transform") {
    auto node = query(p, "scene.get_node", {{"nodeId", node_id}});
    if (truthy(field(node, "locked")) ||
        !truthy(field(node, "effectiveVisible")) ||
        (field(node, "kind") != Value("part") &&
         field(node, "kind") != Value("group")))
      error("表示中・ロックされていないパーツかグループを選択してください。");
    return run("scene.set_transform",
               {{"nodeId", node_id},
                {"coordinateSpace", Value("node-local")},
                {"transform", field(input, "transform")}});
  }
  if (tool == "object.group")
    return run("scene.create_group",
               {{"id", ids.next("group")},
                {"parentId", field(input, "parentId")},
                {"displayName", field(input, "displayName")}});
  if (tool == "object.reparent") {
    Object payload{{"nodeId", node_id}, {"parentId", field(input, "parentId")}};
    if (input.is<Object>() && input.get<Object>().count("index"))
      payload["index"] = field(input, "index");
    return run("scene.reparent_node", payload);
  }
  if (tool == "source.include") {
    Array commands;
    for (const auto &art : field(p, "keyArts").get<Array>())
      for (const auto &member : field(art, "members").get<Array>()) {
        const auto node = field(field(field(p, "scene"), "nodes"),
                                text(field(member, "nodeId")));
        if (field(node, "kind") != Value("part"))
          continue;
        bool registered = false;
        for (const auto &s : field(p, "semanticSlots").get<Array>())
          for (const auto &m : field(s, "mappings").get<Array>())
            if (field(m, "keyArtId") == field(art, "id") &&
                field(m, "nodeId") == field(member, "nodeId"))
              registered = true;
        if (registered)
          continue;
        commands.push_back(command(
            "semantic_slot.create",
            {{"semanticSlot",
              Value(Object{{"id", ids.next("slot")},
                           {"displayName", field(node, "displayName")},
                           {"role", Value()},
                           {"metadata", Value(Object{})},
                           {"mappings",
                            Value(Array{Value(Object{
                                {"keyArtId", field(art, "id")},
                                {"nodeId", field(member, "nodeId")}})})}})}}));
      }
    return plan(commands, commands.empty()
                              ? ""
                              : "Include source parts in Key Art composition");
  }
  if (tool == "keyart.duplicate") {
    auto art = query(p, "keyart.get", {{"keyArtId", art_id}}),
         id = ids.next("keyart");
    Array commands{command(
        "keyart.create",
        {{"keyArt",
          extend(art, {{"id", id},
                       {"displayName", field(input, "displayName")}})}})};
    for (const auto &s : field(p, "semanticSlots").get<Array>())
      for (const auto &m : field(s, "mappings").get<Array>())
        if (field(m, "keyArtId") == art_id)
          commands.push_back(command("semantic_slot.map_node",
                                     {{"semanticSlotId", field(s, "id")},
                                      {"keyArtId", id},
                                      {"nodeId", field(m, "nodeId")}}));
    for (const auto &f : field(p, "meshKeyforms").get<Array>())
      if (field(f, "keyArtId") == art_id)
        commands.push_back(command(
            "mesh_keyform.create",
            {{"keyform",
              extend(f, {{"id", ids.next("keyform")}, {"keyArtId", id}})}}));
    for (const auto &type :
         {std::make_pair("bonePoseKeyforms", "bone.set_keyform"),
          std::make_pair("warpDeformerKeyforms", "deformer.set_keyform")})
      for (const auto &f : field(field(p, "rig"), type.first).get<Array>())
        if (field(f, "keyArtId") == art_id)
          commands.push_back(command(
              type.second, extend(f, {{"keyArtId", id}}).get<Object>()));
    for (const auto &f : field(p, "meshFormCorrectionKeyforms").get<Array>())
      if (field(f, "keyArtId") == art_id)
        commands.push_back(command(
            "mesh_form.create_keyform",
            {{"keyform",
              extend(f, {{"id", ids.next("correction")}, {"keyArtId", id}})}}));
    return plan(commands, "Duplicate Key Art state", {{"keyArtId", id}});
  }
  if (tool == "keyart.rename")
    return run(
        "keyart.update",
        {{"keyArtId", art_id},
         {"keyArt", extend(query(p, "keyart.get", {{"keyArtId", art_id}}),
                           {{"displayName", field(input, "displayName")}})}});
  if (tool == "keyart.member") {
    auto art = query(p, "keyart.get", {{"keyArtId", art_id}});
    auto members = field(art, "members").get<Array>();
    bool found = false;
    for (auto &m : members)
      if (field(m, "nodeId") == field(input, "nodeId")) {
        found = true;
        m = extend(m, {{"opacity", field(input, "opacity")},
                       {"presence", field(input, "presence")},
                       {"drawOrder", field(input, "drawOrder")}});
      }
    if (!found)
      error("Part is not a member of the selected Key Art.");
    return run("keyart.update",
               {{"keyArtId", art_id},
                {"keyArt", extend(art, {{"members", Value(members)}})}});
  }
  if (tool == "keyart.remove")
    return run("keyart.remove", {{"keyArtId", art_id}});
  if (tool == "slot.create")
    return run("semantic_slot.create",
               {{"semanticSlot",
                 Value(Object{{"id", ids.next("slot")},
                              {"displayName", field(input, "displayName")},
                              {"role", Value()},
                              {"mappings", Value(Array{})},
                              {"metadata", Value(Object{})}})}});
  if (tool == "slot.rename")
    return run(
        "semantic_slot.update",
        {{"semanticSlotId", slot_id},
         {"semanticSlot",
          extend(query(p, "semantic_slot.get", {{"semanticSlotId", slot_id}}),
                 {{"displayName", field(input, "displayName")}})}});
  if (tool == "slot.remove")
    return run("semantic_slot.remove", {{"semanticSlotId", slot_id}});
  if (tool == "slot.map" || tool == "slot.unmap") {
    auto selected = find(query(p, "semantic_slot.list"), slot_id);
    if (!selected.is<Object>())
      error("No SemanticSlot selected.");
    auto current = mapping(selected, field(input, "keyArtId"));
    Array commands;
    if (tool == "slot.map") {
      if (field(current, "nodeId") == field(input, "nodeId"))
        return plan({}, "");
      if (current.is<Object>())
        commands.push_back(command("semantic_slot.unmap_node",
                                   {{"semanticSlotId", slot_id},
                                    {"keyArtId", field(input, "keyArtId")}}));
      commands.push_back(command("semantic_slot.map_node",
                                 {{"semanticSlotId", slot_id},
                                  {"keyArtId", field(input, "keyArtId")},
                                  {"nodeId", field(input, "nodeId")}}));
      return plan(commands, "Map SemanticSlot");
    }
    if (!current.is<Object>())
      return plan({}, "");
    return run(
        "semantic_slot.unmap_node",
        {{"semanticSlotId", slot_id}, {"keyArtId", field(input, "keyArtId")}},
        "Unmap SemanticSlot");
  }
  if (tool == "transition.create") {
    auto get_id = [&](const char *key, const char *kind) {
      return input.is<Object>() && input.get<Object>().count(key)
                 ? field(input, key)
                 : ids.next(kind);
    };
    auto id = get_id("transitionId", "transition"),
         program = get_id("programId", "program");
    return plan(
        {command("animation.temporal.create_program",
                 {{"programId", program},
                  {"durationTicks",
                   seconds_ticks(field(input, "durationSeconds"))}}),
         command("transition.create",
                 {{"transition",
                   Value(Object{{"id", id},
                                {"displayName", field(input, "displayName")},
                                {"fromKeyArtId", field(input, "fromKeyArtId")},
                                {"toKeyArtId", field(input, "toKeyArtId")},
                                {"temporalProgramId", program},
                                {"partTransitions", Value(Array{})},
                                {"diagnosticOverrides", Value(Array{})}})}})},
        "Create Transition", {{"transitionId", id}, {"programId", program}});
  }
  if (tool == "transition.endpoint") {
    auto endpoint = text(field(input, "endpoint"));
    if (endpoint != "from" && endpoint != "to")
      error("Unknown endpoint " + endpoint + ".");
    query(p, "keyart.get", {{"keyArtId", field(input, "keyArtId")}});
    if (!transition.is<Object>())
      error("No active Transition.");
    return run("transition.update",
               {{"transitionId", transition_id},
                {"transition",
                 extend(persistent(transition),
                        {{endpoint == "from" ? "fromKeyArtId" : "toKeyArtId",
                          field(input, "keyArtId")}})}},
               endpoint == "from" ? "Set Start Key Art" : "Set End Key Art");
  }
  if (tool == "transition.update" || tool == "transition.remove") {
    auto value = query(p, "transition.get", {{"transitionId", transition_id}}),
         program = field(value, "temporalProgramId");
    if (tool == "transition.remove")
      return plan(
          {command("transition.remove", {{"transitionId", transition_id}}),
           command("animation.temporal.remove_program",
                   {{"programId", program}})},
          "Remove Transition and its owned program");
    return plan(
        {command("transition.update",
                 {{"transitionId", transition_id},
                  {"transition",
                   extend(persistent(value),
                          {{"displayName", field(input, "displayName")}})}}),
         command("animation.temporal.set_duration",
                 {{"programId", program},
                  {"durationTicks",
                   seconds_ticks(field(input, "durationSeconds"))}})},
        "Edit");
  }
  if (tool == "transition.mode" || tool == "transition.topology") {
    const auto previous = field(slot, "partTransition");
    if (tool == "transition.topology") {
      Object payload{{"transitionId", transition_id},
                     {"semanticSlotId", slot_id}};
      for (const auto &v : input.get<Object>())
        payload[v.first] = v.second;
      return plan(
          {command("transition.set_part_mode",
                   {{"transitionId", transition_id},
                    {"semanticSlotId", slot_id},
                    {"partTransitionId", truthy(field(previous, "id"))
                                             ? field(previous, "id")
                                             : ids.next("part_transition")},
                    {"mode", Value("morph")},
                    {"configuration", Value(Object{})}}),
           command("transition.set_part_topology", payload)},
          "Connect shared Morph endpoints");
    }
    const auto mode = text(field(input, "mode"));
    auto valid = modes();
    if (std::find(valid.begin(), valid.end(), Value(mode)) == valid.end())
      error("Unknown PartTransition mode " + mode + ".");
    if (!transition.is<Object>() || !slot.is<Object>())
      error("Select a Transition and SemanticSlot first.");
    if (!truthy(field(field(slot, "availableModes"), mode)))
      error(mode + " is not valid for the selected A/B mapping.");
    Object configuration;
    const auto requested = field(input, "configuration"),
               old = field(previous, "configuration");
    if (mode == "hold") {
      auto endpoint = field(slot, "status") == Value("a-only")   ? Value("from")
                      : field(slot, "status") == Value("b-only") ? Value("to")
                      : truthy(field(requested, "holdEndpoint"))
                          ? field(requested, "holdEndpoint")
                      : truthy(field(old, "holdEndpoint"))
                          ? field(old, "holdEndpoint")
                          : Value("from");
      configuration["holdEndpoint"] = endpoint;
    }
    if (mode == "replace") {
      auto group = field(requested, "compositeGroupId");
      if (group.is<picojson::null>())
        group = field(old, "compositeGroupId");
      if (truthy(group))
        configuration["compositeGroupId"] = group;
    }
    return run("transition.set_part_mode",
               {{"transitionId", transition_id},
                {"partTransitionId", truthy(field(previous, "id"))
                                         ? field(previous, "id")
                                         : ids.next("part_transition")},
                {"semanticSlotId", slot_id},
                {"mode", Value(mode)},
                {"configuration", Value(configuration)}},
               "Set PartTransition mode");
  }
  if (tool == "transition.override") {
    auto diagnostics = query(p, "transition.get_diagnostics",
                             {{"transitionId", transition_id}});
    Value selected;
    for (const auto &d : diagnostics.get<Array>())
      if (field(d, "key") == field(input, "key"))
        selected = d;
    if (!selected.is<Object>())
      error("Diagnostic changed; refresh before acknowledging.");
    Object override;
    for (auto key :
         {"key", "code", "semanticSlotId", "timeTicks", "evidenceFingerprint"})
      if (selected.get<Object>().count(key))
        override[key] = field(selected, key);
    return run(
        "transition.set_diagnostic_override",
        {{"transitionId", transition_id}, {"override", Value(override)}});
  }
  if (tool == "transition.clearOverride") {
    auto payload = input.get<Object>();
    payload["transitionId"] = transition_id;
    return run("transition.clear_diagnostic_override", payload);
  }
  if (tool == "correspondence.apply") {
    auto solve = correspondence_state(p, request);
    editable(p, field(solve, "targetKeyformId"));
    if (!truthy(field(solve, "previewActive")) ||
        !field(solve, "diagnostics").get<Array>().empty())
      error("Create a valid correspondence preview before Apply.");
    return run("mesh_keyform.move_vertices",
               {{"keyformId", field(solve, "targetKeyformId")},
                {"positions", field(solve, "candidatePositions")}},
               "Apply correspondence solve");
  }
  if (tool == "mesh.removeKeyform") {
    editable(p, field(input, "keyformId"));
    return run("mesh_keyform.remove",
               {{"keyformId", field(input, "keyformId")}});
  }
  if (tool == "mesh.removeTopology")
    return run("mesh_topology.remove",
               {{"topologyId", field(input, "topologyId")}});
  if (tool == "mesh.uv") {
    auto form = editable(p, field(input, "keyformId")),
         topology = query(p, "mesh.get_topology",
                          {{"topologyId", field(form, "topologyId")}});
    const auto &vertices = field(topology, "vertexIds").get<Array>();
    auto found =
        std::find(vertices.begin(), vertices.end(), field(input, "vertexId"));
    if (found == vertices.end())
      error("Select a stable mesh vertex.");
    auto i = static_cast<size_t>(std::distance(vertices.begin(), found));
    if (!finite(field(input, "u")) || !finite(field(input, "v")))
      error("UV requires finite coordinates.");
    auto uvs = field(form, "uvs").get<Array>();
    uvs[i * 2] = field(input, "u");
    uvs[i * 2 + 1] = field(input, "v");
    return run("mesh_keyform.update",
               {{"keyformId", field(form, "id")},
                {"keyform", extend(form, {{"uvs", Value(uvs)}})}});
  }
  if (tool == "mesh.align") {
    auto form = editable(p, field(input, "keyformId"));
    if (field(form, "keyArtId") != art_id)
      error("Select the mesh Key Art before alignment.");
    for (auto key :
         {"x", "y", "rotation", "scaleX", "scaleY", "pivotX", "pivotY"})
      if (!finite(field(input, key)))
        error("Alignment requires finite values.");
    auto x = number(field(input, "x")), y = number(field(input, "y")),
         r = number(field(input, "rotation")),
         sx = number(field(input, "scaleX")),
         sy = number(field(input, "scaleY")),
         px = number(field(input, "pivotX")),
         py = number(field(input, "pivotY"));
    Array positions;
    const auto &old = field(form, "positions").get<Array>();
    for (size_t i = 0; i < old.size(); i += 2) {
      auto dx = (number(old[i]) - px) * sx, dy = (number(old[i + 1]) - py) * sy;
      positions.emplace_back(px + x + dx * std::cos(r) - dy * std::sin(r));
      positions.emplace_back(py + y + dx * std::sin(r) + dy * std::cos(r));
    }
    return run("mesh_keyform.move_vertices", {{"keyformId", field(form, "id")},
                                              {"positions", Value(positions)}});
  }
  if (tool == "sample.create") {
    auto id = ids.next("sample"), mesh = truthy(field(input, "meshId"))
                                             ? field(input, "meshId")
                                             : ids.next("mesh_target");
    Array commands;
    if (!truthy(field(input, "meshId")))
      commands.push_back(
          command("animation.mesh_target.create", {{"meshId", mesh}}));
    commands.push_back(command(
        "animation.deformation_sample.create",
        {{"sample", Value(Object{{"id", id},
                                 {"meshId", mesh},
                                 {"topologyId", field(input, "topologyId")},
                                 {"offsets", field(input, "offsets")}})}}));
    return plan(commands, "Create reusable mesh deformation",
                {{"sampleId", id}, {"meshId", mesh}});
  }
  if (tool == "sample.update")
    return run(
        "animation.deformation_sample.update",
        {{"sampleId", field(input, "sampleId")},
         {"sample", extend(query(p, "animation.deformation_sample.get",
                                 {{"sampleId", field(input, "sampleId")}}),
                           {{"offsets", field(input, "offsets")}})}});
  if (tool == "sample.remove")
    return run("animation.deformation_sample.remove",
               {{"sampleId", field(input, "sampleId")}});
  if (tool == "sample.removeTarget")
    return run("animation.mesh_target.remove",
               {{"meshId", field(input, "meshId")}});
  error("Unknown native Key State tool.");
  return Value();
}
} // namespace fl2d_authoring
