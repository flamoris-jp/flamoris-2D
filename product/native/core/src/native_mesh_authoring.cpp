#include "native_authoring.h"
#include <algorithm>
#include <cmath>
#include <limits>
#include <regex>
#include <set>

namespace fl2d_authoring {
Value mesh_state(const Value &p, const Value &input, bool strict) {
  const auto nodeId = field(input, "nodeId");
  Value node = nodeId.is<std::string>()
                   ? field(field(field(p, "scene"), "nodes"), text(nodeId))
                   : Value();
  if (nodeId.is<std::string>())
    query(p, "scene.get_node", {{"nodeId", nodeId}});
  auto selectedArt = field(input, "keyArtId");
  const auto selectedForm = field(input, "keyformId");
  if (!truthy(selectedArt) && truthy(selectedForm))
    selectedArt =
        field(find(field(p, "meshKeyforms"), selectedForm), "keyArtId");
  if (truthy(selectedArt))
    query(p, "keyart.get", {{"keyArtId", selectedArt}});
  Array arts, slots, forms;
  if (node.is<Object>())
    for (const auto &art : field(p, "keyArts").get<Array>())
      for (const auto &member : field(art, "members").get<Array>())
        if (field(member, "nodeId") == nodeId) {
          arts.push_back(art);
          break;
        }
  Value art;
  if (truthy(selectedArt))
    art = find(Value(arts), selectedArt);
  else if (arts.size() == 1)
    art = arts[0];
  if (art.is<Object>())
    for (const auto &slot : field(p, "semanticSlots").get<Array>())
      for (const auto &mapping : field(slot, "mappings").get<Array>())
        if (field(mapping, "nodeId") == nodeId &&
            field(mapping, "keyArtId") == field(art, "id")) {
          slots.push_back(slot);
          break;
        }
  Value slot = slots.size() == 1 ? slots[0] : Value();
  if (slot.is<Object>())
    forms = query(p, "mesh.list_keyforms",
                  {{"keyArtId", field(art, "id")},
                   {"semanticSlotId", field(slot, "id")}})
                .get<Array>();
  Value form = forms.size() == 1 ? forms[0] : Value();
  if (truthy(selectedForm)) {
    auto selected = find(Value(forms), selectedForm);
    if (selected.is<Object>())
      form = selected;
    else if (strict)
      error("MeshKeyform does not belong to the selected Key Art part.");
  }
  Value topology = form.is<Object>()
                       ? query(p, "mesh.get_topology",
                               {{"topologyId", field(form, "topologyId")}})
                       : Value();
  std::string reason;
  if (!node.is<Object>())
    reason = "パーツを選択してください";
  else if (field(node, "kind") != Value("part"))
    reason = "メッシュを作成する描画パーツを選択してください";
  else if (!art.is<Object>())
    reason = arts.empty() ? "選択パーツを含むKey Artがありません"
                          : "パーツが複数のKey "
                            "Artに所属しています。編集対象を明示してください";
  else if (slots.size() > 1)
    reason = "パーツのSemanticSlot対応が曖昧です";
  else if (forms.size() > 1 && !form.is<Object>())
    reason = "編集するメッシュを選択してください";
  const auto& stored = topology;
  return Value(Object{
      {"available", Value(reason.empty())},
      {"reason", Value(reason)},
      {"editingEnabled",
       Value(node.is<Object>() && art.is<Object>() && reason.empty())},
      {"node", node},
      {"nodeId", node.is<Object>() ? nodeId : Value()},
      {"keyArt", art},
      {"semanticSlot", slot},
      {"keyforms", Value(forms)},
      {"selectedKeyformId", field(form, "id")},
      {"selectedTopologyId", field(stored, "id")},
      {"activeKeyform", form},
      {"topology", stored},
      {"topologies", Value(stored.is<Object>() ? Array{stored} : Array{})}});
}
static Array allocate(const Value &p, size_t count, const Value &topology) {
  std::set<std::string> used;
  double sequence =
      std::max(1.0, number(field(topology, "nextVertexSequence"), 1));
  const std::regex pattern("^vtx_([0-9]+)$");
  std::smatch match;
  for (const auto &t : field(p, "meshTopologies").get<Array>())
    for (const auto &id : field(t, "vertexIds").get<Array>()) {
      const auto name = text(id);
      used.insert(name);
      if (std::regex_match(name, match, pattern)) {
        double n = 0;
        try {
          n = std::stod(match[1].str()) + 1;
        } catch (...) {
          error("Stable vertex ID sequence is exhausted.");
        }
        sequence = std::max(sequence, n);
      }
    }
  if (count > 1000000 || !std::isfinite(sequence) ||
      sequence + static_cast<double>(count) > 9007199254740991.0)
    error("Stable vertex ID sequence is exhausted.");
  Array result;
  while (result.size() < count) {
    std::ostringstream s;
    s << "vtx_" << std::setfill('0') << std::setw(4)
      << static_cast<uint64_t>(sequence++);
    if (used.insert(s.str()).second)
      result.emplace_back(s.str());
  }
  return result;
}
Value mesh_tool(const Value &p, const Value &input) {
  const auto state = mesh_state(p, input, true);
  const auto tool = text(field(input, "tool")),
             mode = text(field(input, "context"));
  const auto &data = field(input, "input");
  auto node = query(p, "scene.get_node", {{"nodeId", field(input, "nodeId")}});
  if (truthy(field(node, "locked")) || !truthy(field(node, "effectiveVisible")))
    error("非表示・ロック中のパーツは編集できません。");
  const std::set<std::string> structure{
      "topology.add",       "topology.remove",    "topology.connect",
      "topology.subdivide", "topology.set-label", "topology.clear-label",
      "topology.automesh"};
  if (!(mode == "structure" && structure.count(tool)) &&
      !(mode == "layout" && tool == "deform.move"))
    error("Tool is unavailable in this editing context.");
  const auto &form = field(state, "activeKeyform"),
             &stored = field(state, "topology");
  if (tool == "deform.move") {
    if (!form.is<Object>())
      error("Select an endpoint MeshKeyform first.");
    if (field(form, "positions") == field(data, "positions"))
      return plan({}, "");
    return plan({command("mesh_keyform.move_vertices",
                         {{"keyformId", field(form, "id")},
                          {"positions", field(data, "positions")}})},
                "Move MeshKeyform vertices");
  }
  if (tool == "topology.automesh") {
    const auto &candidate = field(data, "candidate");
    if (!candidate.is<Object>() || !field(candidate, "positions").is<Array>() ||
        !field(candidate, "uvs").is<Array>() ||
        !field(candidate, "indices").is<Array>())
      error("Generate a valid AutoMesh preview before Apply.");
    const auto &positions = field(candidate, "positions"),
               &uvs = field(candidate, "uvs"),
               &indices = field(candidate, "indices");
    if (positions.get<Array>().size() % 2)
      error("Generated mesh must contain compatible vertices, UVs, and "
            "triangles.");
    auto topology = stored.is<Object>()
                        ? query(p, "mesh.get_topology",
                                {{"topologyId", field(stored, "id")}})
                        : Value();
    auto vertices = allocate(p, positions.get<Array>().size() / 2, topology);
    if (topology.is<Object>())
      return plan({command("mesh_topology.apply_generated_mesh",
                           {{"topologyId", field(topology, "id")},
                            {"vertexIds", Value(vertices)},
                            {"indices", indices},
                            {"positions", positions},
                            {"uvs", uvs},
                            {"replaceExisting",
                             Value(truthy(field(data, "replaceExisting")))}})},
                  "Apply Contour AutoMesh", {{"vertexIds", Value(vertices)}});
    if (!truthy(field(state, "available")))
      error(text(field(state, "reason")));
    if (vertices.size() < 3 ||
        uvs.get<Array>().size() != positions.get<Array>().size() ||
        indices.get<Array>().size() < 3 || indices.get<Array>().size() % 3)
      error("Generated mesh must contain compatible vertices, UVs, and "
            "triangles.");
    Ids ids(input);
    auto slot = field(state, "semanticSlot");
    const auto slotId =
        slot.is<Object>() ? field(slot, "id") : ids.next("semantic_slot");
    const auto topologyId = ids.next("topology"),
               keyformId = ids.next("keyform");
    Array commands;
    if (!slot.is<Object>()) {
      commands.push_back(
          command("semantic_slot.create",
                  {{"semanticSlot",
                    Value(Object{{"id", slotId},
                                 {"displayName",
                                  field(field(state, "node"), "displayName")},
                                 {"role", Value()},
                                 {"mappings", Value(Array{})},
                                 {"metadata", Value(Object{})}})}}));
      commands.push_back(
          command("semantic_slot.map_node",
                  {{"semanticSlotId", slotId},
                   {"keyArtId", field(field(state, "keyArt"), "id")},
                   {"nodeId", field(input, "nodeId")}}));
    }
    commands.push_back(command(
        "mesh_topology.create",
        {{"topology", Value(Object{{"id", topologyId},
                                   {"vertexIds", Value(vertices)},
                                   {"indices", indices},
                                   {"vertexMetadata", Value(Object{})}})}}));
    commands.push_back(command(
        "mesh_keyform.create",
        {{"keyform",
          Value(Object{{"id", keyformId},
                       {"topologyId", topologyId},
                       {"keyArtId", field(field(state, "keyArt"), "id")},
                       {"semanticSlotId", slotId},
                       {"positions", positions},
                       {"uvs", uvs}})}}));
    return plan(commands,
                "Create mesh for " +
                    text(field(field(state, "node"), "displayName")),
                {{"vertexIds", Value(vertices)}});
  }
  if (!stored.is<Object>())
    error("Select a MeshTopology first.");
  auto topology =
      query(p, "mesh.get_topology", {{"topologyId", field(stored, "id")}});
  Object payload{{"topologyId", field(topology, "id")}};
  std::string type, label;
  if (tool == "topology.add") {
    type = "mesh_topology.add_vertex";
    label = "Add MeshTopology vertex";
    payload["vertexId"] = truthy(field(data, "vertexId"))
                              ? field(data, "vertexId")
                              : field(topology, "nextVertexId");
    payload["position"] = field(data, "position");
    payload["uv"] = field(data, "uv");
    if (truthy(field(data, "semanticLabel")))
      payload["semanticLabel"] = field(data, "semanticLabel");
  } else if (tool == "topology.remove") {
    type = "mesh_topology.remove_vertex";
    label = "Remove MeshTopology vertex";
    payload["vertexId"] = field(data, "vertexId");
    if (!truthy(payload["vertexId"]))
      error("Select one vertex to remove.");
  } else if (tool == "topology.connect") {
    type = "mesh_topology.create_triangle";
    label = "Create MeshTopology triangle";
    payload["vertexIds"] = field(data, "vertexIds");
  } else if (tool == "topology.subdivide") {
    type = "mesh_topology.subdivide_edge";
    label = "Subdivide MeshTopology edge";
    payload["vertexIds"] = field(data, "vertexIds");
    payload["newVertexId"] = truthy(field(data, "newVertexId"))
                                 ? field(data, "newVertexId")
                                 : field(topology, "nextVertexId");
  } else if (tool == "topology.set-label") {
    type = "mesh_topology.set_vertex_label";
    label = "Set vertex semantic label";
    payload["vertexId"] = field(data, "vertexId");
    payload["semanticLabel"] = field(data, "semanticLabel");
    if (!truthy(payload["vertexId"]))
      error("Select one vertex to label.");
  } else {
    type = "mesh_topology.clear_vertex_label";
    label = "Clear vertex semantic label";
    payload["vertexId"] = field(data, "vertexId");
    if (!truthy(payload["vertexId"]))
      error("Select one vertex to clear its label.");
  }
  return plan({command(type, payload)}, label);
}
} // namespace fl2d_authoring
