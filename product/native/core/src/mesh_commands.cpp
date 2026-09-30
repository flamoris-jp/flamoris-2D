#include "native_commands.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdlib>
#include <set>
namespace fl2d_commands {
Value command(const std::string& type, const Object& payload);
[[noreturn]] void fail(const char* code);
namespace {
Array& list(Value& value, const char* key) { return value.get<Object>().at(key).get<Array>(); }
std::string text(const Value& value, const char* key) { return field(value, key).get<std::string>(); }
Value& entity(Array& values, const Value& id, const char* error) {
    auto at = std::find_if(values.begin(), values.end(), [&](const Value& value) { return field(value, "id") == id; });
    if (at == values.end()) fail(error);
    return *at;
}
std::vector<Value*> keyforms(Value& project, const Value& id) {
    std::vector<Value*> result;
    for (auto& keyform : list(project, "meshKeyforms")) if (field(keyform, "topologyId") == id) result.push_back(&keyform);
    return result;
}
Value inverse_snapshot(Value& project, const Value& topology) {
    Array saved; for (const auto* keyform : keyforms(project, field(topology, "id"))) saved.push_back(*keyform);
    return command("mesh_topology.restore_snapshot", Object{{"snapshot", Value(Object{{"topology", topology}, {"keyforms", Value(saved)}})}});
}
std::vector<std::string> affected(Value& topology, const std::vector<Value*>& forms, const Array& extra = {}) {
    std::vector<std::string> result{text(topology, "id")}; for (const auto* form : forms) result.push_back(text(*form, "id"));
    for (const auto& id : extra) result.push_back(id.get<std::string>());
    return result;
}
void locks(Value& project, const Value& id, bool form = false) {
    const auto& values = form ? list(project, "meshFormCorrectionKeyforms") : list(project.get<Object>().at("rig"), "skinBindings");
    for (const auto& value : values) if (field(value, "topologyId") == id) fail(form ? "MESH_TOPOLOGY_LOCKED_BY_FORM_CORRECTION" : "MESH_TOPOLOGY_LOCKED_BY_SKIN_BINDING");
}
size_t vertex_index(const Value& topology, const Value& id) {
    const auto& values = field(topology, "vertexIds").get<Array>(); auto at = std::find(values.begin(), values.end(), id);
    if (at == values.end()) fail("MESH_TOPOLOGY_VERTEX_NOT_FOUND");
    return static_cast<size_t>(at - values.begin());
}
bool issued_number(const Value& id, double& number) {
    const auto& value = id.get<std::string>();
    if (value.size() <= 4 || value.substr(0, 4) != "vtx_" || !std::all_of(value.begin() + 4, value.end(), [](char c) { return c >= '0' && c <= '9'; })) return false;
    const auto parsed = std::strtod(value.c_str() + 4, nullptr); number = std::isfinite(parsed) ? parsed : 1e100; return true;
}
bool safe_integer(const Value& value) { return value.is<double>() && std::floor(value.get<double>()) == value.get<double>() && std::abs(value.get<double>()) <= 9007199254740991.0; }
void advance(Value& topology, const Value& id) {
    const auto& previous = field(topology, "nextVertexSequence");
    double number = 0; if (issued_number(id, number)) topology.get<Object>()["nextVertexSequence"] = Value(std::max(safe_integer(previous) ? previous.get<double>() : 1, number + 1));
}
void new_vertex(Value& project, const Value& topology, const Value& id) {
    for (const auto& existing : list(project, "meshTopologies")) for (const auto& owned : field(existing, "vertexIds").get<Array>()) if (owned == id) fail("MESH_TOPOLOGY_DUPLICATE_VERTEX");
    const auto& previous = field(topology, "nextVertexSequence");
    double number = 0; if (issued_number(id, number) && safe_integer(previous) && number < previous.get<double>()) fail("MESH_TOPOLOGY_VERTEX_ID_REUSED");
}
void label_available(const Value& topology, const Value& id, const Value& label) {
    if (!field(topology, "vertexMetadata").is<Object>()) return;
    for (const auto& [key, metadata] : field(topology, "vertexMetadata").get<Object>()) if (Value(key) != id && field(metadata, "semanticLabel") == label) fail("MESH_TOPOLOGY_DUPLICATE_SEMANTIC_LABEL");
}
Object& metadata(Value& topology) {
    auto& object = topology.get<Object>();
    if (!field(topology, "vertexMetadata").is<Object>()) object["vertexMetadata"] = Value(Object{});
    return object.at("vertexMetadata").get<Object>();
}
double area(const Array& positions, const std::array<size_t, 3>& triangle) {
    const auto a = triangle[0] * 2, b = triangle[1] * 2, c = triangle[2] * 2;
    return (positions.at(b).get<double>() - positions.at(a).get<double>()) * (positions.at(c + 1).get<double>() - positions.at(a + 1).get<double>()) -
        (positions.at(b + 1).get<double>() - positions.at(a + 1).get<double>()) * (positions.at(c).get<double>() - positions.at(a).get<double>());
}
std::array<size_t, 3> triangle_at(const Array& indices, size_t offset) {
    return {static_cast<size_t>(indices.at(offset).get<double>()), static_cast<size_t>(indices.at(offset + 1).get<double>()), static_cast<size_t>(indices.at(offset + 2).get<double>())};
}
void push_indices(Array& indices, std::initializer_list<size_t> values) { for (auto value : values) indices.emplace_back(static_cast<double>(value)); }
void generated(Value& project, const Value& topology, const Value& p) {
    if (!field(p, "replaceExisting").get<bool>()) fail("AUTOMESH_DESTRUCTIVE_REPLACEMENT_REQUIRED");
    const auto& vertices = field(p, "vertexIds").get<Array>(); std::set<std::string> seen;
    for (const auto& id : vertices) if (!seen.insert(id.get<std::string>()).second) fail("AUTOMESH_DUPLICATE_CANDIDATE_VERTEX");
    if (vertices.size() < 3) fail("AUTOMESH_DUPLICATE_CANDIDATE_VERTEX");
    for (const auto& id : vertices) for (const auto& other : list(project, "meshTopologies")) if (field(other, "id") != field(topology, "id"))
        for (const auto& owned : field(other, "vertexIds").get<Array>()) if (owned == id) fail("MESH_TOPOLOGY_DUPLICATE_VERTEX_ACROSS_TOPOLOGIES");
    const auto& positions = field(p, "positions").get<Array>(); const auto& uvs = field(p, "uvs").get<Array>(); const auto& indices = field(p, "indices").get<Array>();
    if (positions.size() != vertices.size() * 2) fail("MESH_KEYFORM_POSITION_COUNT_MISMATCH");
    if (uvs.size() != vertices.size() * 2) fail("MESH_KEYFORM_UV_COUNT_MISMATCH");
    if (indices.size() < 3 || indices.size() % 3) fail("AUTOMESH_TRIANGULATION_FAILURE");
    std::set<std::array<size_t, 3>> signatures;
    for (size_t i = 0; i < indices.size(); i += 3) {
        for (size_t j = i; j < i + 3; ++j) {
            const auto number = indices.at(j).get<double>();
            if (std::floor(number) != number || number < 0 || number >= static_cast<double>(vertices.size())) fail("MESH_TOPOLOGY_INVALID_VERTEX_REFERENCE");
        }
        const auto triangle = triangle_at(indices, i); auto signature = triangle; std::sort(signature.begin(), signature.end());
        if (signature[0] == signature[1] || signature[1] == signature[2]) fail("MESH_TOPOLOGY_TRIANGLE_REPEATED_VERTEX");
        if (!signatures.insert(signature).second) fail("MESH_TOPOLOGY_TRIANGLE_DUPLICATE");
        if (std::abs(area(positions, triangle)) <= 2e-4) fail("MESH_TOPOLOGY_TRIANGLE_DEGENERATE");
    }
}
}
bool apply_mesh(Value& project, const std::string& type, const Value& p, Applied& result) {
    static const std::set<std::string> types{"mesh_keyform.move_vertices", "mesh_topology.set_vertex_label", "mesh_topology.clear_vertex_label", "mesh_topology.add_vertex", "mesh_topology.remove_vertex", "mesh_topology.create_triangle", "mesh_topology.subdivide_edge", "mesh_topology.apply_generated_mesh", "mesh_topology.restore_snapshot"};
    if (!types.count(type)) return false;
    if (type == "mesh_keyform.move_vertices") {
        auto& form = entity(list(project, "meshKeyforms"), field(p, "keyformId"), "mesh_keyform.not_found");
        auto inverse = command(type, Object{{"keyformId", field(form, "id")}, {"positions", field(form, "positions")}});
        form.get<Object>()["positions"] = field(p, "positions"); result = {inverse, {text(form, "id"), text(form, "topologyId")}}; return true;
    }
    if (type == "mesh_topology.restore_snapshot") {
        const auto& saved = field(p, "snapshot"); const auto& saved_topology = field(saved, "topology");
        auto& topology = entity(list(project, "meshTopologies"), field(saved_topology, "id"), "mesh_topology.not_found");
        const auto inverse = inverse_snapshot(project, topology); topology = saved_topology;
        std::vector<std::string> ids{text(saved_topology, "id")}; for (const auto& id : field(saved_topology, "vertexIds").get<Array>()) ids.push_back(id.get<std::string>());
        for (const auto& saved_form : field(saved, "keyforms").get<Array>()) {
            entity(list(project, "meshKeyforms"), field(saved_form, "id"), "MESH_TOPOLOGY_SNAPSHOT_INVALID") = saved_form; ids.push_back(text(saved_form, "id"));
        }
        result = {inverse, ids}; return true;
    }
    auto& topology = entity(list(project, "meshTopologies"), field(p, "topologyId"), "mesh_topology.not_found"); const auto id = field(topology, "id");
    if (type == "mesh_topology.set_vertex_label" || type == "mesh_topology.clear_vertex_label") {
        const auto vertex = field(p, "vertexId"); vertex_index(topology, vertex);
        const auto previous = field(field(topology, "vertexMetadata"), vertex.get<std::string>()); const auto old_label = field(previous, "semanticLabel");
        if (type == "mesh_topology.set_vertex_label") label_available(topology, vertex, field(p, "semanticLabel"));
        else if (!old_label.is<std::string>() || old_label.get<std::string>().empty()) fail("MESH_TOPOLOGY_SEMANTIC_LABEL_NOT_FOUND");
        Object inverse{{"topologyId", id}, {"vertexId", vertex}};
        if (old_label.is<std::string>() && !old_label.get<std::string>().empty()) inverse["semanticLabel"] = old_label;
        if (type == "mesh_topology.set_vertex_label") metadata(topology)[vertex.get<std::string>()] = Value(Object{{"semanticLabel", field(p, "semanticLabel")}}); else metadata(topology).erase(vertex.get<std::string>());
        result = {command(inverse.count("semanticLabel") ? "mesh_topology.set_vertex_label" : "mesh_topology.clear_vertex_label", inverse), {id.get<std::string>(), vertex.get<std::string>()}}; return true;
    }
    auto forms = keyforms(project, id); auto& vertices = list(topology, "vertexIds"); auto& indices = list(topology, "indices");
    if (type == "mesh_topology.apply_generated_mesh") {
        locks(project, id); locks(project, id, true); generated(project, topology, p); auto inverse = inverse_snapshot(project, topology);
        vertices = field(p, "vertexIds").get<Array>(); indices = field(p, "indices").get<Array>(); topology.get<Object>()["vertexMetadata"] = Value(Object{});
        if (!safe_integer(field(topology, "nextVertexSequence"))) topology.get<Object>()["nextVertexSequence"] = Value(1.0);
        for (const auto& vertex : vertices) advance(topology, vertex);
        for (auto* form : forms) for (auto key : {"positions", "uvs"}) form->get<Object>()[key] = field(p, key);
        result = {inverse, affected(topology, forms, vertices)}; return true;
    }
    if (type == "mesh_topology.add_vertex") {
        locks(project, id); const auto vertex = field(p, "vertexId"); new_vertex(project, topology, vertex);
        if (p.get<Object>().count("semanticLabel")) label_available(topology, vertex, field(p, "semanticLabel"));
        auto inverse = inverse_snapshot(project, topology); vertices.push_back(vertex); advance(topology, vertex);
        if (p.get<Object>().count("semanticLabel")) metadata(topology)[vertex.get<std::string>()] = Value(Object{{"semanticLabel", field(p, "semanticLabel")}});
        for (auto* form : forms) for (auto pair : {std::pair<const char*, const char*>{"positions", "position"}, {"uvs", "uv"}}) for (auto key : {"x", "y"}) list(*form, pair.first).push_back(field(field(p, pair.second), key));
        result = {inverse, affected(topology, forms, Array{vertex})}; return true;
    }
    if (type == "mesh_topology.remove_vertex") {
        locks(project, id); locks(project, id, true); const auto vertex = field(p, "vertexId"); const auto removed = vertex_index(topology, vertex);
        if (vertices.size() <= 3) fail("MESH_TOPOLOGY_REMOVE_UNSAFE");
        Array next;
        for (size_t i = 0; i < indices.size(); i += 3) {
            auto triangle = triangle_at(indices, i); if (std::find(triangle.begin(), triangle.end(), removed) != triangle.end()) continue;
            for (auto item : triangle) next.emplace_back(static_cast<double>(item > removed ? item - 1 : item));
        }
        if (next.empty()) fail("MESH_TOPOLOGY_REMOVE_UNSAFE");
        auto inverse = inverse_snapshot(project, topology); vertices.erase(vertices.begin() + removed); indices = next;
        if (field(topology, "vertexMetadata").is<Object>()) metadata(topology).erase(vertex.get<std::string>());
        for (auto* form : forms) for (auto key : {"positions", "uvs"}) { auto& values = list(*form, key); values.erase(values.begin() + removed * 2, values.begin() + removed * 2 + 2); }
        result = {inverse, affected(topology, forms, Array{vertex})}; return true;
    }
    const auto selected = field(p, "vertexIds").get<Array>();
    if (type == "mesh_topology.create_triangle") {
        if (selected.size() != 3 || selected[0] == selected[1] || selected[1] == selected[2] || selected[0] == selected[2]) fail("MESH_TOPOLOGY_TRIANGLE_REPEATED_VERTEX");
        std::array<size_t, 3> triangle{vertex_index(topology, selected[0]), vertex_index(topology, selected[1]), vertex_index(topology, selected[2])}; auto signature = triangle; std::sort(signature.begin(), signature.end());
        for (size_t i = 0; i < indices.size(); i += 3) { auto other = triangle_at(indices, i); std::sort(other.begin(), other.end()); if (other == signature) fail("MESH_TOPOLOGY_TRIANGLE_DUPLICATE"); }
        for (const auto* form : forms) if (std::abs(area(field(*form, "positions").get<Array>(), triangle)) <= 2e-4) fail("MESH_TOPOLOGY_TRIANGLE_DEGENERATE");
        auto inverse = inverse_snapshot(project, topology); push_indices(indices, {triangle[0], triangle[1], triangle[2]}); result = {inverse, affected(topology, forms, selected)}; return true;
    }
    locks(project, id); if (selected.size() != 2 || selected[0] == selected[1]) fail("MESH_TOPOLOGY_EDGE_INVALID");
    const auto a = vertex_index(topology, selected[0]), b = vertex_index(topology, selected[1]); const auto vertex = field(p, "newVertexId"); new_vertex(project, topology, vertex);
    Array next; bool found = false; const auto new_index = vertices.size();
    for (size_t i = 0; i < indices.size(); i += 3) {
        const auto triangle = triangle_at(indices, i); int start = -1;
        for (int j = 0; j < 3; ++j) if ((triangle[j] == a && triangle[(j + 1) % 3] == b) || (triangle[j] == b && triangle[(j + 1) % 3] == a)) { start = j; break; }
        if (start < 0) { push_indices(next, {triangle[0], triangle[1], triangle[2]}); continue; }
        found = true; const auto first = triangle[start], second = triangle[(start + 1) % 3], third = triangle[(start + 2) % 3]; push_indices(next, {first, new_index, third, new_index, second, third});
    }
    if (!found) fail("MESH_TOPOLOGY_EDGE_NOT_FOUND");
    auto inverse = inverse_snapshot(project, topology); vertices.push_back(vertex); advance(topology, vertex); indices = next;
    for (auto* form : forms) for (auto key : {"positions", "uvs"}) { auto& values = list(*form, key); for (size_t j = 0; j < 2; ++j) values.emplace_back((values.at(a * 2 + j).get<double>() + values.at(b * 2 + j).get<double>()) / 2); }
    auto extra = selected; extra.push_back(vertex); result = {inverse, affected(topology, forms, extra)}; return true;
}
}
