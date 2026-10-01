#include "js_text.h"
#include "native_authoring.h"
#include "native_locale.h"
#include "native_rig_evaluation.h"
#include <algorithm>
#include <cmath>
#include <map>
#include <set>

namespace fl2d_authoring {
namespace {
const Value zero(Object{
    {"x", Value(0.0)}, {"y", Value(0.0)}, {"rotation", Value(0.0)}});
void editable(const Value &p, const Value &id) {
  if (!truthy(id))
    return;
  const auto n = query(p, "scene.get_node", {{"nodeId", id}});
  if (truthy(field(n, "locked")) || !truthy(field(n, "effectiveVisible")))
    error("非表示・ロック中の対象は編集できません。");
}
void art_valid(const Value &p, const Value &id) {
  if (truthy(id) && !find(query(p, "keyart.list"), id).is<Object>())
    error("Unknown KeyArt " + text(id) + ".");
}
Value bone_pose(const Value &p, const Value &bone, const Value &art) {
  return truthy(bone) && truthy(art)
             ? query(p, "bone.get_keyform",
                     {{"boneId", bone}, {"keyArtId", art}})
             : Value();
}
Value one(const std::string &type, const Object &payload,
          const std::string &label = "Edit", const Object &result = {}) {
  return plan({command(type, payload)}, label, result);
}
Value warp_defaults(const Value &d) {
  Array result;
  const auto &bounds = field(d, "bounds");
  for (const auto &id : field(d, "controlPointIds").get<Array>()) {
    auto cp = find(field(d, "controlPoints"), id);
    if (!cp.is<Object>())
      error("Missing WarpControlPoint " + text(id) + ".");
    result.emplace_back(Object{
        {"controlPointId", id},
        {"x", Value(number(field(bounds, "left")) +
                    number(field(cp, "u")) * (number(field(bounds, "right")) -
                                              number(field(bounds, "left"))))},
        {"y", Value(number(field(bounds, "top")) +
                    number(field(cp, "v")) * (number(field(bounds, "bottom")) -
                                              number(field(bounds, "top"))))}});
  }
  return Value(result);
}
Value binding_for_target(const Value &p, const Value &target) {
  const auto bindings = query(p, "bone.list_rigid_bindings");
  for (const auto &binding : bindings.get<Array>())
    if (field(binding, "targetNodeId") == target)
      return binding;
  return Value();
}
Value clipping_state(const Value &p, const Value &target) {
  if (!truthy(target))
    return Value();
  auto n = query(p, "scene.get_node", {{"nodeId", target}});
  bool available = field(n, "kind") == Value("part");
  Array candidates;
  if (available) {
    for (const auto &item : field(field(p, "scene"), "nodes").get<Object>())
      if (field(item.second, "kind") == Value("part") &&
          field(item.second, "id") != target)
        candidates.emplace_back(
            Object{{"id", field(item.second, "id")},
                   {"displayName", field(item.second, "displayName")}});
    fl2d_locale::Collator order;
    std::stable_sort(candidates.begin(), candidates.end(),
                     [&](const Value &a, const Value &b) {
                       auto x = text(field(a, "displayName")),
                            y = text(field(b, "displayName"));
                       if (order.less(x, y))
                         return true;
                       if (order.less(y, x))
                         return false;
                       return order.less(text(field(a, "id")),
                                         text(field(b, "id")));
                     });
  }
  return Value(Object{{"available", Value(available)},
                      {"binding", available ? query(p, "clipping.get_for_node",
                                                    {{"nodeId", target}})
                                            : Value()},
                      {"sourceCandidates", Value(candidates)},
                      {"showMask", Value(false)}});
}
Value canonical(const Value &input) {
  if (!input.is<Array>() || input.get<Array>().empty() ||
      input.get<Array>().size() > 4)
    error("A weighted vertex requires one to four Bone influences.");
  Array values;
  for (const auto &influence : input.get<Array>()) {
    const auto &id = field(influence, "boneId"),
               &weight = field(influence, "weight");
    if (!id.is<std::string>() || text(id).empty())
      error("Skin influence Bone ID is required.");
    if (!weight.is<double>() || !std::isfinite(weight.get<double>()) ||
        weight.get<double>() <= 0 || weight.get<double>() > 1)
      error("Skin influence weight must be finite, greater than zero, and at "
            "most one.");
    values.emplace_back(Object{{"boneId", id}, {"weight", weight}});
  }
  try {
    return Value(fl2d_commands::canonical_influences(Value(values)));
  } catch (const Failure &e) {
    std::string code = e.code;
    if (code == "SKIN_BINDING_INFLUENCE_DUPLICATE")
      error("A weighted vertex cannot reference the same Bone more than once.");
    if (code == "SKIN_BINDING_WEIGHT_NOT_NORMALIZED")
      error("Skin influence weights must sum to 1 within 0.000001.");
    error("Canonical skin influence weight must remain finite and positive.");
  }
  return Value();
}
Value normalized(const Array &input) {
  double sum = 0;
  for (const auto &i : input)
    sum += number(field(i, "weight"));
  if (!(sum > 0) || !std::isfinite(sum))
    error("A weighted vertex must retain at least one positive influence.");
  auto values = input;
  for (auto &v : values)
    v.get<Object>()["weight"] = Value(number(field(v, "weight")) / sum);
  return canonical(Value(values));
}
Value weight_entry(const Value &binding, const Value &vertex) {
  for (const auto &entry : field(binding, "vertexWeights").get<Array>())
    if (field(entry, "vertexId") == vertex)
      return entry;
  error("Stable vertex " + text(vertex) + " has no weight entry.");
  return Value();
}
Value weight_tool(const Value &p, const Value &context, const std::string &tool,
                  const Value &input, Ids &ids) {
  const auto &binding_id = field(context, "bindingId"),
             &target = field(context, "nodeId"),
             &bone = field(context, "boneId");
  if (truthy(binding_id))
    query(p, "skin.get_binding", {{"bindingId", binding_id}});
  if (tool == "weight.create") {
    auto topology_id = field(input, "topologyId");
    if (!truthy(target) || !truthy(topology_id) || !truthy(bone))
      error("Creating a SkinBinding requires target Part, topology, and active "
            "Bone.");
    auto topology =
        query(p, "mesh.get_topology", {{"topologyId", topology_id}});
    Array weights;
    for (const auto &vertex : field(topology, "vertexIds").get<Array>())
      weights.emplace_back(Object{
          {"vertexId", vertex},
          {"influences", Value(Array{Value(Object{{"boneId", bone},
                                                  {"weight", Value(1.0)}})})}});
    return one("skin.create_binding",
               {{"binding", Value(Object{{"id", ids.next("skin_binding")},
                                         {"targetNodeId", target},
                                         {"topologyId", topology_id},
                                         {"enabled", Value(true)},
                                         {"vertexWeights", Value(weights)}})}},
               "Create SkinBinding");
  }
  if (!truthy(binding_id))
    error("Select an active SkinBinding first.");
  const auto binding =
      query(p, "skin.get_binding", {{"bindingId", binding_id}});
  const auto &vertex = field(input, "vertexId");
  const auto current = tool == "weight.paint" || tool == "weight.replace"
                           ? Value()
                           : weight_entry(binding, vertex);
  if (tool == "weight.paint") {
    if (!truthy(bone))
      error("Select an active Bone first.");
    const auto strength = number(field(input, "strength"), .1);
    const auto operation = truthy(field(input, "operation"))
                               ? text(field(input, "operation"))
                               : "add";
    if (operation != "add" && operation != "subtract")
      error("Unknown weight brush operation.");
    if (!std::isfinite(strength) || strength <= 0 || strength > 1)
      throw fl2d_queries::Error{"RangeError",
                                "Weight brush strength must be within 0..1."};
    std::set<std::string, decltype(&fl2d_text::less)> vertices(
        &fl2d_text::less);
    for (const auto &id : field(input, "vertexIds").get<Array>())
      vertices.insert(text(id));
    Array weights;
    for (const auto &id : vertices) {
      auto values =
          field(weight_entry(binding, Value(id)), "influences").get<Array>();
      auto it = std::find_if(values.begin(), values.end(), [&](const Value &v) {
        return field(v, "boneId") == bone;
      });
      if (operation == "add") {
        if (it == values.end()) {
          if (values.size() >= 4)
            error("Adding a fifth influence requires an explicit replace.");
          values.emplace_back(
              Object{{"boneId", bone}, {"weight", Value(strength)}});
        } else
          it->get<Object>()["weight"] =
              Value(number(field(*it, "weight")) + strength);
      } else if (it != values.end()) {
        const auto w = number(field(*it, "weight")) - strength;
        if (w > 0)
          it->get<Object>()["weight"] = Value(w);
        else
          values.erase(it);
      }
      weights.emplace_back(
          Object{{"vertexId", Value(id)}, {"influences", normalized(values)}});
    }
    return weights.empty() ? plan({}, "")
                           : one("skin.set_weights_bulk",
                                 {{"bindingId", binding_id},
                                  {"vertexWeights", Value(weights)}},
                                 "Paint skin weights");
  }
  Value influences;
  std::string label;
  if (tool == "weight.replace") {
    influences = canonical(field(input, "influences"));
    label = "Replace skin influences";
  } else if (tool == "weight.normalize") {
    influences = normalized(field(current, "influences").get<Array>());
    label = "Normalize skin weights";
  } else {
    const auto &w = field(input, "weight");
    if (!w.is<double>() || !std::isfinite(w.get<double>()) ||
        w.get<double>() < 0 || w.get<double>() > 1)
      throw fl2d_queries::Error{"RangeError",
                                "Numeric weight must be within 0..1."};
    const double weight = w.get<double>();
    Array others;
    bool exists = false;
    for (const auto &i : field(current, "influences").get<Array>())
      if (field(i, "boneId") == bone)
        exists = true;
      else
        others.push_back(i);
    if (weight == 1)
      influences =
          Value(Array{Value(Object{{"boneId", bone}, {"weight", Value(1.0)}})});
    else if (weight == 0)
      influences = normalized(others);
    else {
      if (!exists && field(current, "influences").get<Array>().size() >= 4)
        error("Adding a fifth influence requires an explicit replace.");
      Array next = others.empty() ? Array{} : normalized(others).get<Array>();
      for (auto &i : next)
        i.get<Object>()["weight"] =
            Value(number(field(i, "weight")) * (1 - weight));
      next.emplace_back(Object{{"boneId", bone}, {"weight", Value(weight)}});
      influences = canonical(Value(next));
    }
    label = "Set numeric skin weight";
  }
  return one("skin.set_vertex_weights",
             {{"bindingId", binding_id},
              {"vertexId", vertex},
              {"influences", canonical(influences)}},
             label);
}
} // namespace
Value rig_state(const Value &p, const Value &context) {
  const auto &art = field(context, "keyArtId"),
             &bone_id = field(context, "boneId");
  art_valid(p, art);
  const auto bone =
      truthy(bone_id) ? query(p, "bone.get", {{"boneId", bone_id}}) : Value();
  const auto arts = query(p, "keyart.list"), pose = bone_pose(p, bone_id, art);
  Value editable_value;
  if (bone.is<Object>()) {
    editable_value = field(bone, "restLocalTransform");
    editable_value.get<Object>()["length"] = field(bone, "length");
  }
  Value bone_state(
      Object{{"mode", Value("edit")},
             {"activeKeyArt", find(arts, art)},
             {"keyArts", arts},
             {"selectedBone", bone},
             {"selectedBoneId", truthy(bone_id) ? bone_id : Value()},
             {"hoverBoneId", Value()},
             {"ghostKeyArtId", Value()},
             {"keyform", pose},
             {"editableValue", editable_value},
             {"dragging", Value(false)}});
  Array warps;
  const auto deformers = query(p, "deformer.list");
  for (const auto &summary : deformers.get<Array>()) {
    auto full =
        query(p, "deformer.get", {{"deformerId", field(summary, "id")}});
    auto keyform =
        truthy(art)
            ? query(p, "deformer.get_keyform",
                    {{"deformerId", field(full, "id")}, {"keyArtId", art}})
            : Value();
    auto positions = keyform.is<Object>() ? field(keyform, "controlPoints")
                                          : warp_defaults(full);
    auto projected = fl2d_evaluation::deformer_lattice(p, full, art, positions);
    auto &o = full.get<Object>();
    o["positions"] = positions;
    o["documentPositions"] = field(projected, "documentPositions");
    o["diagnostics"] = field(projected, "diagnostics");
    o["worldTransform"] =
        field(query(p, "scene.get_node", {{"nodeId", field(full, "id")}}),
              "worldTransform");
    warps.push_back(full);
  }
  return Value(Object{
      {"bones", query(p, "bone.list")},
      {"bone", bone_state},
      {"fk", truthy(art) ? fl2d_evaluation::bone_fk(p, art, true)
                         : Value(Object{{"poses", Value(Array{})},
                                        {"diagnostics", Value(Array{})}})},
      {"warps", Value(warps)},
      {"part", truthy(field(context, "nodeId")) ? mesh_state(p, context, false)
                                                : Value()},
      {"rigidBindings", query(p, "bone.list_rigid_bindings")},
      {"skinBindings", query(p, "skin.list_bindings")},
      {"rotationConstraints", query(p, "bone.list_rotation_constraints")},
      {"ikConstraints", query(p, "bone.list_two_bone_ik")},
      {"clipping", clipping_state(p, field(context, "nodeId"))},
      {"rootId", field(field(p, "scene"), "rootId")}});
}
Value rig_tool(const Value &p, const Value &request) {
  const auto &context = field(request, "context"),
             &input = field(request, "input");
  const auto tool = text(field(request, "tool"));
  Ids ids(request);
  const auto &node = field(context, "nodeId"),
             &bone_id = field(context, "boneId"),
             &art = field(context, "keyArtId"),
             &deformer_id = field(context, "deformerId");
  for (const auto &id : {node, bone_id, deformer_id})
    editable(p, id);
  art_valid(p, art);
  const auto bone =
      truthy(bone_id) ? query(p, "bone.get", {{"boneId", bone_id}}) : Value();
  auto set_pose = [&](const Value &delta) {
    return truthy(bone_id) && truthy(art)
               ? one("bone.set_keyform",
                     {{"boneId", bone_id},
                      {"keyArtId", art},
                      {"localDelta", delta}},
                     bone_pose(p, bone_id, art).is<Object>()
                         ? "Edit Bone pose"
                         : "Create Bone pose")
               : plan({}, "");
  };
  auto rest = [&](const Value &value) {
    return bone.is<Object>()
               ? one("bone.set_rest",
                     {{"boneId", bone_id},
                      {"restLocalTransform",
                       Value(Object{{"x", field(value, "x")},
                                    {"y", field(value, "y")},
                                    {"rotation", field(value, "rotation")}})},
                      {"length", field(value, "length")}},
                     "Edit Bone rest")
               : plan({}, "");
  };
  if (tool == "bone.create")
    return one(
        "bone.create",
        {{"id", ids.next("bone")},
         {"displayName", field(input, "displayName").is<picojson::null>()
                             ? Value("Bone")
                             : field(input, "displayName")},
         {"parentNodeId",
          bone.is<Object>() ? bone_id : field(field(p, "scene"), "rootId")},
         {"restLocalTransform",
          Value(Object{
              {"x", bone.is<Object>() ? field(bone, "length") : Value(0.0)},
              {"y", Value(0.0)},
              {"rotation", Value(0.0)}})},
         {"length", field(input, "length").is<picojson::null>()
                        ? Value(100.0)
                        : field(input, "length")}},
        bone.is<Object>() ? "Create child Bone" : "Create Bone");
  if (tool == "bone.createAt") {
    const auto parent =
        truthy(bone_id) ? bone_id : field(field(p, "scene"), "rootId");
    const auto a = fl2d_evaluation::authoring_point(p, parent, art,
                                                    field(input, "start")),
               b = fl2d_evaluation::authoring_point(p, parent, art,
                                                    field(input, "end"));
    const auto x = number(field(b, "x")) - number(field(a, "x")),
               y = number(field(b, "y")) - number(field(a, "y")),
               length = std::hypot(x, y);
    if (length < .001)
      error("Boneの始点から終点へドラッグしてください。");
    return one("bone.create",
               {{"id", ids.next("bone")},
                {"displayName", Value("Bone")},
                {"parentNodeId", parent},
                {"restLocalTransform",
                 Value(Object{{"x", field(a, "x")},
                              {"y", field(a, "y")},
                              {"rotation", Value(std::atan2(y, x))}})},
                {"length", Value(length)}});
  }
  if (tool == "bone.moveDocument") {
    if (!bone.is<Object>())
      error("Select a Bone.");
    const bool pose = truthy(field(input, "pose"));
    auto a = fl2d_evaluation::authoring_point(
             p, bone_id, art, field(input, "start"), pose, !pose),
         b = fl2d_evaluation::authoring_point(p, bone_id, art,
                                              field(input, "end"), pose, !pose);
    auto keyform = bone_pose(p, bone_id, art);
    auto current =
        pose ? (keyform.is<Object>() ? field(keyform, "localDelta") : zero)
             : field(bone, "restLocalTransform");
    auto &o = current.get<Object>();
    o["x"] = Value(number(field(current, "x")) + number(field(b, "x")) -
                   number(field(a, "x")));
    o["y"] = Value(number(field(current, "y")) + number(field(b, "y")) -
                   number(field(a, "y")));
    if (pose)
      return set_pose(current);
    o["length"] = field(bone, "length");
    return rest(current);
  }
  if (tool == "bone.rest")
    return rest(input);
  if (tool == "bone.pose")
    return set_pose(input);
  if (tool == "bone.reset") {
    auto pose = bone_pose(p, bone_id, art);
    return pose.is<Object>() ? one("bone.reset_keyform",
                                   {{"boneId", bone_id}, {"keyArtId", art}},
                                   "Reset Bone pose")
                             : plan({}, "");
  }
  if (tool == "bone.remove" || tool == "bone.rename" ||
      tool == "bone.reparent") {
    if (!bone.is<Object>())
      return plan({}, "");
    Object payload{{"boneId", bone_id}};
    std::string label = tool == "bone.remove"   ? "Remove Bone"
                        : tool == "bone.rename" ? "Rename Bone"
                                                : "Reparent Bone";
    if (tool == "bone.rename")
      payload["displayName"] = field(input, "displayName");
    if (tool == "bone.reparent")
      payload["parentNodeId"] = field(input, "parentNodeId");
    return one(tool, payload, label);
  }
  if (tool == "bone.enabled")
    return one("bone.set_enabled",
               {{"boneId", bone_id}, {"enabled", field(input, "enabled")}});
  if (tool == "bone.bind") {
    if (!truthy(bone_id))
      error("Select a Bone before creating a rigid attachment.");
    auto binding = binding_for_target(p, node);
    if (binding.is<Object>()) {
      Array commands;
      if (field(binding, "boneId") != bone_id)
        commands.push_back(command(
            "bone.set_rigid_binding_bone",
            {{"bindingId", field(binding, "id")}, {"boneId", bone_id}}));
      if (!truthy(field(binding, "enabled")))
        commands.push_back(command(
            "bone.set_rigid_binding_enabled",
            {{"bindingId", field(binding, "id")}, {"enabled", Value(true)}}));
      return plan(commands,
                  commands.empty() ? "" : "Change rigid Bone attachment");
    }
    return one("bone.create_rigid_binding",
               {{"binding", Value(Object{{"id", ids.next("rigid_binding")},
                                         {"targetNodeId", node},
                                         {"boneId", bone_id},
                                         {"enabled", Value(true)}})}},
               "Create rigid Bone attachment");
  }
  if (tool == "bone.bindingEnabled" || tool == "bone.unbind") {
    auto binding = binding_for_target(p, node);
    if (!binding.is<Object>()) {
      if (tool == "bone.unbind")
        return plan({}, "");
      error("Select a rigidly attached Part.");
    }
    Object payload{{"bindingId", field(binding, "id")}};
    if (tool == "bone.bindingEnabled")
      payload["enabled"] = field(input, "enabled");
    return one(tool == "bone.unbind" ? "bone.remove_rigid_binding"
                                     : "bone.set_rigid_binding_enabled",
               payload);
  }
  if (tool == "bone.mirror") {
    const auto &target_id = field(input, "targetBoneId");
    editable(p, target_id);
    if (bone_id == target_id)
      error("Mirror source and target must be different explicit Bone IDs.");
    if (!bone.is<Object>() || !truthy(target_id))
      error("Select an explicit source/target Bone pair.");
    auto target = query(p, "bone.get", {{"boneId", target_id}});
    const auto axis = field(input, "axisX");
    if (!axis.is<double>() || !std::isfinite(axis.get<double>()))
      throw fl2d_queries::Error{"TypeError", "Mirror axis must be finite."};
    const auto pi = std::acos(-1.0);
    auto rotation = [&](double value) {
      value = std::fmod(value, 2 * pi);
      if (value > pi)
        value -= 2 * pi;
      if (value < -pi)
        value += 2 * pi;
      return Value(value == 0 ? 0 : value);
    };
    if (truthy(field(input, "pose"))) {
      if (!truthy(art))
        error("Select an active Key Art for pose mirror.");
      auto pose = bone_pose(p, bone_id, art);
      auto delta = pose.is<Object>() ? field(pose, "localDelta") : zero;
      return one(
          "bone.set_keyform",
          {{"boneId", target_id},
           {"keyArtId", art},
           {"localDelta",
            Value(Object{
                {"x", Value(-number(field(delta, "x")))},
                {"y", field(delta, "y")},
                {"rotation", rotation(-number(field(delta, "rotation")))}})}},
          "Mirror Bone pose");
    }
    if (field(bone, "parentNodeId") != field(target, "parentNodeId"))
      error("Rest mirror requires source and target Bones to share a Scene "
            "parent.");
    auto transform = field(bone, "restLocalTransform");
    return one(
        "bone.set_rest",
        {{"boneId", target_id},
         {"restLocalTransform",
          Value(Object{{"x", Value(axis.get<double>() * 2 -
                                   number(field(transform, "x")))},
                       {"y", field(transform, "y")},
                       {"rotation",
                        rotation(pi - number(field(transform, "rotation")))}})},
         {"length", field(bone, "length")}},
        "Mirror Bone rest");
  }
  if (tool == "bone.limit") {
    auto existing = query(p, "bone.get_rotation_constraint_for_bone",
                          {{"boneId", bone_id}});
    if (existing.is<Object>())
      return plan({command("bone.set_rotation_constraint_bounds",
                           {{"constraintId", field(existing, "id")},
                            {"minRotation", field(input, "minRotation")},
                            {"maxRotation", field(input, "maxRotation")}}),
                   command("bone.set_rotation_constraint_enabled",
                           {{"constraintId", field(existing, "id")},
                            {"enabled", field(input, "enabled")}})},
                  "Edit Bone rotation limit");
    return one("bone.create_rotation_constraint",
               {{"constraint",
                 Value(Object{{"id", ids.next("rotation_limit")},
                              {"boneId", bone_id},
                              {"enabled", field(input, "enabled")},
                              {"minRotation", field(input, "minRotation")},
                              {"maxRotation", field(input, "maxRotation")}})}});
  }
  if (tool == "bone.removeLimit")
    return one("bone.remove_rotation_constraint",
               {{"constraintId", field(input, "constraintId")}});
  if (tool == "ik.create")
    return one(
        "bone.create_two_bone_ik",
        {{"constraint",
          Value(Object{{"id", ids.next("two_bone_ik")},
                       {"rootBoneId", field(input, "rootBoneId")},
                       {"midBoneId", field(input, "midBoneId")},
                       {"endBoneId", field(input, "endBoneId")},
                       {"bendDirection", truthy(field(input, "bendDirection"))
                                             ? field(input, "bendDirection")
                                             : Value("counterclockwise")},
                       {"enabled", field(input, "enabled").is<picojson::null>()
                                       ? Value(true)
                                       : field(input, "enabled")}})}},
        "Create two-Bone IK");
  if (tool.rfind("ik.", 0) == 0) {
    const auto &constraint_id = field(input, "constraintId");
    auto constraint =
        query(p, "bone.get_two_bone_ik", {{"constraintId", constraint_id}});
    for (auto key : {"rootBoneId", "midBoneId", "endBoneId"})
      editable(p, field(constraint, key));
    if (tool == "ik.remove")
      return one("bone.remove_two_bone_ik", {{"constraintId", constraint_id}},
                 "Remove two-Bone IK");
    if (tool == "ik.enabled")
      return one("bone.set_two_bone_ik_enabled",
                 {{"constraintId", constraint_id},
                  {"enabled", field(input, "enabled")}},
                 truthy(field(input, "enabled")) ? "Enable two-Bone IK"
                                                 : "Disable two-Bone IK");
    if (tool == "ik.bend")
      return one("bone.set_two_bone_ik_bend_direction",
                 {{"constraintId", constraint_id},
                  {"bendDirection", field(input, "bendDirection")}},
                 "Change IK bend direction");
    if (tool != "ik.target")
      error("Unknown native Rig tool.");
    if (!truthy(art))
      error("Select an IK constraint and active Key Art before dragging its "
            "target.");
    auto solved = query(p, "bone.solve_two_bone_ik",
                        {{"constraintId", constraint_id},
                         {"keyArtId", art},
                         {"target", field(input, "target")}});
    std::string message;
    for (const auto &d : field(solved, "diagnostics").get<Array>()) {
      if (!message.empty())
        message += ", ";
      message += text(field(d, "code"));
    }
    if (!message.empty())
      error(message);
    Array commands;
    if (field(solved, "solution").is<Object>())
      for (const auto &pose :
           field(field(solved, "solution"), "poseDeltas").get<Array>())
        commands.push_back(command(
            "bone.set_keyform", {{"boneId", field(pose, "boneId")},
                                 {"keyArtId", field(pose, "keyArtId")},
                                 {"localDelta", field(pose, "localDelta")}}));
    return plan(commands, commands.empty() ? "" : "Bake two-Bone IK pose");
  }
  if (tool == "warp.create" || tool == "warp.grid") {
    const double n = number(field(input, "size"));
    if (n != 2 && n != 3 && n != 4)
      error("Warp grid must be 2, 3 or 4.");
    auto id = tool == "warp.create" ? ids.next("warp") : deformer_id;
    Array controls;
    for (int i = 0; i < static_cast<int>(n * n); ++i)
      controls.push_back(ids.next("control_point"));
    if (tool == "warp.grid")
      return one("deformer.set_grid", {{"deformerId", id},
                                       {"columns", Value(n)},
                                       {"rows", Value(n)},
                                       {"controlPointIds", Value(controls)}});
    Array commands{command("deformer.create_warp",
                           {{"id", id},
                            {"displayName", field(input, "displayName")},
                            {"parentNodeId", field(input, "parentNodeId")},
                            {"columns", Value(n)},
                            {"rows", Value(n)},
                            {"bounds", field(input, "bounds")},
                            {"controlPointIds", Value(controls)}})};
    if (field(input, "childNodeIds").is<Array>())
      for (const auto &child : field(input, "childNodeIds").get<Array>()) {
        editable(p, child);
        commands.push_back(command("deformer.reparent_node",
                                   {{"nodeId", child}, {"parentId", id}}));
      }
    return plan(commands, "Create Warp and attach targets",
                {{"deformerId", id}});
  }
  if (tool == "warp.remove")
    return one("deformer.remove", {{"deformerId", deformer_id}});
  if (tool == "warp.rename")
    return one("deformer.rename",
               {{"deformerId", deformer_id},
                {"displayName", field(input, "displayName")}});
  if (tool == "warp.attach")
    return one("deformer.reparent_node",
               {{"nodeId", node}, {"parentId", field(input, "parentNodeId")}});
  if (tool == "warp.move" || tool == "warp.moveDocument" ||
      tool == "warp.reset") {
    auto d = query(p, "deformer.get", {{"deformerId", deformer_id}}),
         original = query(p, "deformer.get_keyform",
                          {{"deformerId", deformer_id}, {"keyArtId", art}}),
         defaults = warp_defaults(d);
    auto positions = original.is<Object>()
                         ? field(original, "controlPoints").get<Array>()
                         : defaults.get<Array>();
    auto selected = field(input, "controlPointIds").is<Array>()
                        ? field(input, "controlPointIds")
                        : field(d, "controlPointIds");
    for (const auto &id : selected.get<Array>())
      if (std::find(field(d, "controlPointIds").get<Array>().begin(),
                    field(d, "controlPointIds").get<Array>().end(),
                    id) == field(d, "controlPointIds").get<Array>().end())
        error("Unknown Warp control point.");
    double x = number(field(input, "x")), y = number(field(input, "y"));
    if (tool == "warp.moveDocument") {
      if (!truthy(art))
        error("親Warpの編集座標へ変換できません。");
      auto a = fl2d_evaluation::authoring_point(p, deformer_id, art,
                                                field(input, "start")),
           b = fl2d_evaluation::authoring_point(p, deformer_id, art,
                                                field(input, "end"));
      x = number(field(b, "x")) - number(field(a, "x"));
      y = number(field(b, "y")) - number(field(a, "y"));
    }
    for (auto &position : positions)
      if (std::find(selected.get<Array>().begin(), selected.get<Array>().end(),
                    field(position, "controlPointId")) !=
          selected.get<Array>().end()) {
        if (tool == "warp.reset") {
          for (const auto &reset : defaults.get<Array>())
            if (field(reset, "controlPointId") ==
                field(position, "controlPointId")) {
              position = reset;
              break;
            }
        } else {
          position.get<Object>()["x"] = Value(number(field(position, "x")) + x);
          position.get<Object>()["y"] = Value(number(field(position, "y")) + y);
        }
      }
    return one("deformer.set_keyform", {{"deformerId", deformer_id},
                                        {"keyArtId", art},
                                        {"controlPoints", Value(positions)}});
  }
  if (tool == "weight.create" || tool == "weight.paint" ||
      tool == "weight.numeric" || tool == "weight.normalize" ||
      tool == "weight.replace")
    return weight_tool(p, context, tool, input, ids);
  if (tool == "weight.remove")
    return one("skin.remove_binding",
               {{"bindingId", field(context, "bindingId")}});
  if (tool == "weight.clear")
    return one("skin.clear_vertex_weights",
               {{"bindingId", field(context, "bindingId")},
                {"vertexId", field(input, "vertexId")}});
  if (tool == "weight.enabled")
    return one("skin.set_enabled", {{"bindingId", field(context, "bindingId")},
                                    {"enabled", field(input, "enabled")}});
  if (tool.rfind("clipping.", 0) == 0) {
    auto binding = query(p, "clipping.get_for_node", {{"nodeId", node}});
    if (tool == "clipping.source")
      return binding.is<Object>()
                 ? one("clipping.set_source",
                       {{"bindingId", field(binding, "id")},
                        {"sourceNodeId", field(input, "sourceNodeId")}},
                       "Set clipping source")
                 : one("clipping.create",
                       {{"binding",
                         Value(Object{
                             {"id", ids.next("clipping_binding")},
                             {"targetNodeId", node},
                             {"sourceNodeId", field(input, "sourceNodeId")},
                             {"mode", Value("inside")},
                             {"enabled", Value(true)}})}},
                       "Create clipping binding");
    if (tool == "clipping.enabled") {
      if (!binding.is<Object>())
        error("Choose Clip To before enabling clipping.");
      return one("clipping.set_enabled",
                 {{"bindingId", field(binding, "id")},
                  {"enabled", field(input, "enabled")}},
                 truthy(field(input, "enabled")) ? "Enable clipping"
                                                 : "Disable clipping");
    }
    if (tool == "clipping.remove")
      return binding.is<Object>()
                 ? one("clipping.remove", {{"bindingId", field(binding, "id")}},
                       "Remove clipping binding")
                 : plan({}, "");
    error("Unknown native Rig tool.");
  }
  if (tool == "form.move" || tool == "form.reset") {
    auto state = mesh_state(p, context, true),
         topology = field(state, "topology"),
         slot = field(state, "semanticSlot");
    if (!topology.is<Object>() || !slot.is<Object>())
      error("Select a prepared Part mesh.");
    const auto topology_id = field(topology, "id"), slot_id = field(slot, "id");
    auto correction = query(p, "mesh_form.get_for_context",
                            {{"topologyId", topology_id},
                             {"keyArtId", art},
                             {"semanticSlotId", slot_id}});
    if (tool == "form.reset")
      return correction.is<Object>()
                 ? one("mesh_form.reset_keyform",
                       {{"keyformId", field(correction, "id")}},
                       "Reset form correction")
                 : plan({}, "");
    std::set<std::string> selected;
    for (const auto &vertex : field(input, "vertexIds").get<Array>()) {
      auto id = text(vertex);
      if (selected.count(id))
        selected.erase(id);
      else
        selected.insert(id);
    }
    if (selected.empty())
      error("Select at least one stable vertex first.");
    const auto &dx = field(input, "x"), &dy = field(input, "y");
    if (!dx.is<double>() || !dy.is<double>() ||
        !std::isfinite(dx.get<double>()) || !std::isfinite(dy.get<double>()))
      throw fl2d_queries::Error{"TypeError", "Gesture delta must be finite."};
    std::map<std::string, Value> offsets;
    if (correction.is<Object>())
      for (const auto &value : field(correction, "vertexOffsets").get<Array>())
        offsets[text(field(value, "vertexId"))] = value;
    for (const auto &id : selected) {
      auto original = offsets.count(id) ? offsets.at(id) : Value();
      offsets[id] = Value(Object{
          {"vertexId", Value(id)},
          {"x", Value(number(field(original, "x")) + dx.get<double>())},
          {"y", Value(number(field(original, "y")) + dy.get<double>())}});
    }
    Array values;
    for (const auto &entry : offsets)
      values.push_back(entry.second);
    auto canonical = Value(fl2d_commands::canonical_offsets(Value(values)));
    if (correction.is<Object>())
      return one("mesh_form.set_vertex_offsets",
                 {{"keyformId", field(correction, "id")},
                  {"vertexOffsets", canonical}},
                 "Edit form correction");
    return one(
        "mesh_form.create_keyform",
        {{"keyform", Value(Object{{"id", ids.next("mesh_form_correction")},
                                  {"topologyId", topology_id},
                                  {"keyArtId", art},
                                  {"semanticSlotId", slot_id},
                                  {"vertexOffsets", canonical}})}},
        "Create and edit form correction");
  }
  error("Unknown native Rig tool.");
  return Value();
}
} // namespace fl2d_authoring
